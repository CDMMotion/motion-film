// Mótion Film -- Captions core: everything between whisper.cpp's JSON and
// the caption list handed to host.jsx's createCaptionLayers. Pure JS, no
// DOM and no After Effects, so it also runs under plain Node for tests:
//
//   readWav16(bytes)              16-bit PCM WAV -> { rate, samples }
//   speechActivity(samples, rate) where in the audio there is sound
//   wordsFromWhisper(json)        whisper -ojf (with -dtw) -> timed words
//   cleanWords(words, activity)   drop hallucinated lines, snap to the sound
//   captionRules(mode, overrides) a caption style's split/timing rules
//   prepareWords(words, rules, c) the words as shown (case, punctuation)
//   buildCaptions(words, rules)   words -> [{ text, start, end, words }]
//   offsetCaptions(caps, rules)   the sync offset
//
// Times are seconds from the start of the transcribed audio.
(function (root, factory) {
  // CEP's Node context can expose a global `module` in the panel too, so
  // only a window-less environment (plain Node) counts as CommonJS.
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory();
  } else {
    root.MFCaptionsCore = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HOP = 0.01;          // activity resolution (s)
  var MIN_WORD = 0.08;     // shortest a word may last (s)
  var LEAD_IN = 0.02;      // kept before a word's first loud frame (s)
  var TAIL_OUT = 0.06;     // kept after its last loud frame (s)
  var CHAIN_GAP = 0.25;    // shorter holes between captions are closed (no blinking)

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  // ---------------------------------------------------------------- audio

  // ffmpeg writes "fmt " and "data" plus optional chunks (LIST...) in
  // between, so the chunks are walked instead of assuming a 44-byte header.
  function readWav16(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function tag(at) {
      return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    }
    if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
      throw new Error("The converted audio isn't a WAV file.");
    }
    var rate = 0;
    var channels = 0;
    var bits = 0;
    var at = 12;
    while (at + 8 <= bytes.length) {
      var id = tag(at);
      var size = view.getUint32(at + 4, true);
      if (id === "fmt ") {
        channels = view.getUint16(at + 10, true);
        rate = view.getUint32(at + 12, true);
        bits = view.getUint16(at + 22, true);
      } else if (id === "data") {
        if (bits !== 16 || !rate) {
          throw new Error("The converted audio isn't 16-bit PCM.");
        }
        var end = Math.min(bytes.length, at + 8 + size);
        var count = Math.floor((end - at - 8) / (2 * channels));
        var samples = new Float32Array(count);
        for (var i = 0; i < count; i += 1) {
          samples[i] = view.getInt16(at + 8 + i * 2 * channels, true) / 32768;
        }
        return { rate: rate, samples: samples };
      }
      at += 8 + size + (size % 2);
    }
    throw new Error("The converted audio has no data.");
  }

  function quantile(values, q) {
    var sorted = Array.prototype.slice.call(values).sort(function (a, b) { return a - b; });
    if (!sorted.length) {
      return -120;
    }
    return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  }

  // Loudness every 10 ms (RMS over a 20 ms window, dBFS), then a mask of
  // the frames clearly above the noise floor. The threshold sits a quarter
  // of the way from the floor to the loud parts (at least 8 dB over the
  // floor, never under -55 dBFS); holes under 80 ms (inside a word) are
  // closed. Returns { mask, hop, peakDb, activeRatio }.
  function speechActivity(samples, rate) {
    var hop = Math.max(1, Math.round(rate * HOP));
    var frames = Math.ceil(samples.length / hop);
    var db = new Float32Array(frames);
    for (var f = 0; f < frames; f += 1) {
      var a = Math.max(0, f * hop - (hop >> 1));
      var b = Math.min(samples.length, a + 2 * hop);
      var sum = 0;
      for (var s = a; s < b; s += 1) {
        sum += samples[s] * samples[s];
      }
      db[f] = b > a ? 10 * Math.log(sum / (b - a) + 1e-12) / Math.LN10 : -120;
    }
    var floor = quantile(db, 0.1);
    var peak = quantile(db, 0.995);
    var threshold = Math.max(-55, floor + Math.max(8, (peak - floor) * 0.25));
    var mask = new Uint8Array(frames);
    for (f = 0; f < frames; f += 1) {
      mask[f] = db[f] > threshold ? 1 : 0;
    }
    for (f = 1; f < frames; f += 1) {
      if (mask[f] || !mask[f - 1]) {
        continue;
      }
      var g = f;
      while (g < frames && !mask[g]) {
        g += 1;
      }
      if (g < frames && g - f < 8) {
        for (var k = f; k < g; k += 1) {
          mask[k] = 1;
        }
      }
      f = g;
    }
    var active = 0;
    for (f = 0; f < frames; f += 1) {
      active += mask[f];
    }
    return { mask: mask, hop: HOP, peakDb: peak, activeRatio: frames ? active / frames : 0 };
  }

  function isSilent(activity) {
    return activity.peakDb < -60 || activity.activeRatio < 0.003;
  }

  // ---------------------------------------------------------------- words

  // Control tokens ([_BEG_], [_TT_123], <|en|>) never carry speech.
  function isControlToken(text) {
    var t = String(text).replace(/^\s+|\s+$/g, "");
    return /^\[_.*\]$/.test(t) || /^<\|.*\|>$/.test(t);
  }

  // A token that's only punctuation sticks to the word before it -- except
  // an opening quote/bracket after a space, which starts the next word.
  function isTrailingPunctuation(text) {
    return /^\s*[.,!?;:…"'»”)\]-]+$/.test(text) && !/^\s[«“("'\[]/.test(text);
  }

  function endsSentence(text) {
    return /[.!?…]["'»”)]*$/.test(text);
  }

  // Whole words with times, from `whisper-cli -ojf` (token level). With
  // `-dtw`, a token's t_dtw (10 ms units) marks where that token ENDS, so
  // a word runs from the end of the token before it to the t_dtw of its
  // own last token; the leading edge after a pause lands in the silence
  // and is fixed later by cleanWords. Without DTW, token offsets are used.
  // Returns [{ text, start, end, prob, seg, eos }].
  function wordsFromWhisper(json) {
    var segments = (json && json.transcription) || [];
    var dtw = false;
    segments.forEach(function (segment) {
      (segment.tokens || []).forEach(function (token) {
        if (token.t_dtw >= 0) {
          dtw = true;
        }
      });
    });
    var words = [];
    var lastEnd = 0;
    segments.forEach(function (segment, segIndex) {
      var groups = [];
      var current = null;
      (segment.tokens || []).forEach(function (token) {
        var text = token.text || "";
        if (isControlToken(text)) {
          return;
        }
        var offsets = token.offsets || {};
        var end = dtw && token.t_dtw >= 0 ? token.t_dtw / 100 : (offsets.to || 0) / 1000;
        end = Math.max(end, lastEnd);
        var start = dtw ? lastEnd : Math.max((offsets.from || 0) / 1000, lastEnd);
        var punct = isTrailingPunctuation(text);
        if (current && (punct || !/^\s/.test(text))) {
          current.raw += text;
          if (!punct) {
            current.end = end;
          }
          current.probs.push(token.p || 0);
        } else {
          current = { raw: text.replace(/^\s+/, ""), start: start, end: end, probs: [token.p || 0] };
          groups.push(current);
        }
        lastEnd = end;
      });
      // A token can cut a multi-byte letter in half (ç, ã -> U+FFFD); the
      // segment text has it whole, so it wins whenever the word counts agree.
      var spoken = String(segment.text || "").replace(/\s+/g, " ").replace(/^ | $/g, "").split(" ").filter(Boolean);
      var useSegment = spoken.length === groups.length;
      groups.forEach(function (group, i) {
        var text = useSegment ? spoken[i] : group.raw.replace(/�/g, "");
        if (!text) {
          return;
        }
        var prob = 0;
        group.probs.forEach(function (p) { prob += p; });
        words.push({
          text: text,
          start: group.start,
          end: Math.max(group.end, group.start),
          prob: prob / group.probs.length,
          seg: segIndex,
          eos: endsSentence(text)
        });
      });
    });
    // "[Música]", "(risos)", "♪": sound descriptions, not speech
    return words.filter(function (word) {
      return !/^[\[(].*[\])][.,!?]*$/.test(word.text) && !/^[♪♫*]+$/.test(word.text);
    });
  }

  function plain(text) {
    return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
  }

  // Lines whisper likes to invent over silence or music (compared plain).
  var INVENTED_LINES = [
    "obrigadoporassistir", "obrigadaporassistir", "inscrevasenocanal", "legendaspelacomunidadeamaraorg",
    "thanksforwatching", "thankyouforwatching", "pleasesubscribe", "subtitlesbytheamaraorgcommunity",
    "graciasporver", "subtitulosrealizadosporlacomunidaddeamaraorg", "musica", "music", "aplausos", "applause"
  ];

  function loudShare(list, activity) {
    var a = Math.floor(list[0].start / activity.hop);
    var b = Math.ceil(list[list.length - 1].end / activity.hop);
    var on = 0;
    for (var f = Math.max(0, a); f < Math.min(activity.mask.length, b); f += 1) {
      on += activity.mask[f];
    }
    return b > a ? on / (b - a) : 0;
  }

  // Whole whisper segments are dropped when they're a known invented line
  // over little sound, or lie (almost) entirely over silence. Then every
  // word is snapped to the sound: one that starts in silence (or over the
  // previous word) moves to where the sound begins, one whose end runs
  // into silence comes back to where the sound stops.
  function cleanWords(words, activity, duration) {
    var bySegment = [];
    words.forEach(function (word) {
      var last = bySegment[bySegment.length - 1];
      if (!last || last.seg !== word.seg) {
        last = { seg: word.seg, words: [] };
        bySegment.push(last);
      }
      last.words.push(word);
    });
    var kept = [];
    bySegment.forEach(function (group) {
      var text = plain(group.words.map(function (w) { return w.text; }).join(""));
      var loud = loudShare(group.words, activity);
      var prob = 0;
      group.words.forEach(function (w) { prob += w.prob; });
      prob /= group.words.length;
      var invented = INVENTED_LINES.some(function (line) {
        return text === line || (text.indexOf(line) >= 0 && text.length < line.length + 6);
      });
      if ((invented && loud < 0.5) || loud < 0.02 || (loud < 0.1 && prob < 0.5)) {
        return;
      }
      group.words.forEach(function (w) { kept.push(w); });
    });

    var mask = activity.mask;
    var hop = activity.hop;
    var out = kept.map(function (w) {
      return { text: w.text, start: w.start, end: w.end, eos: w.eos };
    });
    out.forEach(function (word, i) {
      var first = -1;
      var last = -1;
      for (var f = Math.max(0, Math.floor(word.start / hop)); f < Math.min(mask.length, Math.ceil(word.end / hop)); f += 1) {
        if (mask[f]) {
          if (first < 0) {
            first = f;
          }
          last = f;
        }
      }
      if (first < 0) {
        return; // nothing loud inside: keep whisper's guess
      }
      var previousEnd = i > 0 ? out[i - 1].end : 0;
      var startFrame = Math.floor(word.start / hop);
      if (!mask[startFrame] || word.start <= previousEnd) {
        var start = Math.max(previousEnd, first * hop - LEAD_IN);
        if (start < word.end - MIN_WORD) {
          word.start = start;
        }
      }
      var end = (last + 1) * hop + TAIL_OUT;
      if (end < word.end && end > word.start + MIN_WORD) {
        word.end = end;
      }
    });
    out.forEach(function (word, i) {
      if (i > 0 && word.start < out[i - 1].end) {
        word.start = out[i - 1].end;
      }
      if (word.end - word.start < MIN_WORD) {
        word.end = word.start + MIN_WORD;
      }
      if (duration && word.end > duration) {
        word.end = duration;
        word.start = Math.min(word.start, Math.max(0, duration - MIN_WORD));
      }
      word.start = round3(word.start);
      word.end = round3(word.end);
    });
    return out;
  }

  // ---------------------------------------------------------------- captions

  // How each caption style splits and times its captions (durations in
  // seconds). "word" = One at a time: a block of a few words whose words
  // show one by one, so it splits like a short caption.
  var MODE_RULES = {
    classic: { maxWords: 12, maxChars: 38, maxLines: 2, minDuration: 1, maxDuration: 6, pauseBreak: 0.7, linger: 0.3, bySentence: true, punctuation: true, offsetMs: 0 },
    dynamic: { maxWords: 3, maxChars: 26, maxLines: 1, minDuration: 0.4, maxDuration: 2.5, pauseBreak: 0.35, linger: 0.15, bySentence: true, punctuation: false, offsetMs: 0 },
    word: { maxWords: 5, maxChars: 24, maxLines: 2, minDuration: 0.5, maxDuration: 3.5, pauseBreak: 0.5, linger: 0.2, bySentence: true, punctuation: false, offsetMs: 0 },
    // Reels / Viral: blocks of up to 7 words, then planHighlights cuts them
    // around their highlighted word
    viral: { maxWords: 7, maxChars: 40, maxLines: 3, minDuration: 0.6, maxDuration: 3.5, pauseBreak: 0.45, linger: 0.2, bySentence: true, punctuation: false, offsetMs: 0 }
  };

  // The style's rules with the user's overrides (Adjust > Caption split);
  // empty / invalid overrides keep the style's own value.
  function captionRules(mode, overrides) {
    var base = MODE_RULES[mode] || MODE_RULES.classic;
    var rules = {};
    var key;
    for (key in base) {
      rules[key] = base[key];
    }
    for (key in (overrides || {})) {
      if (Object.prototype.hasOwnProperty.call(base, key) && overrides[key] !== "" && overrides[key] !== null && overrides[key] !== undefined) {
        rules[key] = typeof base[key] === "boolean" ? !!overrides[key] : Number(overrides[key]);
        if (typeof base[key] === "number" && isNaN(rules[key])) {
          rules[key] = base[key];
        }
      }
    }
    rules.maxWords = Math.max(1, Math.round(rules.maxWords));
    rules.maxChars = Math.max(4, Math.round(rules.maxChars));
    rules.maxLines = Math.max(1, Math.round(rules.maxLines));
    rules.minDuration = Math.max(0.04, rules.minDuration);
    rules.maxDuration = Math.max(rules.minDuration, rules.maxDuration);
    rules.pauseBreak = Math.max(0.05, rules.pauseBreak);
    rules.linger = Math.max(0, rules.linger);
    return rules;
  }

  function defaultRules(mode) {
    return captionRules(mode, null);
  }

  var PUNCTUATION = /[.,!?;:…"“”«»()\[\]¿¡]/g;

  function applyCase(text, textCase) {
    if (textCase === "upper") { return text.toLocaleUpperCase("pt-BR"); }
    if (textCase === "lower") { return text.toLocaleLowerCase("pt-BR"); }
    return text;
  }

  // The words as they'll be shown: case, and without punctuation unless
  // the rules keep it (the sentence end is remembered either way, so the
  // split still breaks there). Words left empty are dropped.
  function prepareWords(words, rules, textCase) {
    var out = [];
    words.forEach(function (word) {
      var text = String(word.text).replace(/^\s+|\s+$/g, "");
      if (!rules.punctuation) {
        text = text.replace(PUNCTUATION, "").replace(/^[-–—]+|[-–—]+$/g, "");
      }
      text = applyCase(text, textCase);
      if (!text) {
        return;
      }
      out.push({ text: text, start: word.start, end: word.end, eos: word.eos !== undefined ? word.eos : endsSentence(word.text) });
    });
    return out;
  }

  // Moves every caption (and its words) by the rules' sync offset.
  function offsetCaptions(captions, rules) {
    var shift = (Number(rules.offsetMs) || 0) / 1000;
    if (!shift) {
      return captions;
    }
    captions.forEach(function (caption) {
      caption.start = round3(Math.max(0, caption.start + shift));
      caption.end = round3(Math.max(caption.start + 0.04, caption.end + shift));
      caption.words.forEach(function (w) {
        w.start = round3(Math.max(0, w.start + shift));
        w.end = round3(Math.max(0, w.end + shift));
      });
    });
    return captions;
  }

  // Short words a caption or a line shouldn't end on (they lean on the
  // next word): articles, prepositions, conjunctions -- PT, EN, ES.
  var LEANING = /^(a|o|as|os|um|uma|uns|umas|de|da|do|das|dos|em|na|no|nas|nos|e|ou|que|se|com|por|pra|pro|para|ao|aos|à|às|mas|meu|minha|seu|sua|the|a|an|of|to|and|or|in|on|at|for|with|from|my|your|el|la|los|las|y|en|del|al|con|un|una|su|sus)$/i;

  function leans(text) {
    return LEANING.test(String(text).replace(/[^\wÀ-ÿ]/g, ""));
  }

  // Splits a caption's words into at most maxLines lines of maxChars. Two
  // lines: the split with the most even lengths, a slightly shorter first
  // line, a break after a comma and never a line ending on a leaning word.
  // Returns null when the words don't fit; a lone word always fits.
  function wrapLines(texts, maxChars, maxLines) {
    var whole = texts.join(" ");
    if (whole.length <= maxChars || texts.length === 1) {
      return [whole];
    }
    if (maxLines < 2) {
      return null;
    }
    var best = null;
    var bestCost = Infinity;
    for (var i = 1; i < texts.length; i += 1) {
      var top = texts.slice(0, i).join(" ");
      var bottom = texts.slice(i).join(" ");
      if (top.length > maxChars || bottom.length > maxChars) {
        continue;
      }
      var cost = Math.abs(top.length - bottom.length) + (top.length > bottom.length ? 2 : 0);
      if (/[,;:]$/.test(texts[i - 1])) {
        cost -= 5;
      }
      if (leans(texts[i - 1])) {
        cost += 8;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = [top, bottom];
      }
    }
    return best;
  }

  function fits(words, rules) {
    if (words.length === 1) {
      return true;
    }
    if (words.length > rules.maxWords || words[words.length - 1].end - words[0].start > rules.maxDuration) {
      return false;
    }
    return !!wrapLines(words.map(function (w) { return w.text; }), rules.maxChars, rules.maxLines);
  }

  // Inside one phrase (no long pause, no sentence end), the cheapest way
  // to cut it into captions that fit: every caption costs a flat 100 (so
  // fewer captions win), plus the square of its length over the room it
  // has (so the cut evens them out), less for ending on a comma, more for
  // ending on a leaning word or leaving a word alone.
  function splitPhrase(phrase, rules) {
    var room = rules.maxChars * rules.maxLines;
    var cost = [0];
    var from = [0];
    for (var j = 1; j <= phrase.length; j += 1) {
      cost[j] = Infinity;
      from[j] = j - 1;
      for (var i = j - 1; i >= 0; i -= 1) {
        var block = phrase.slice(i, j);
        if (!fits(block, rules)) {
          break; // longer blocks only get worse
        }
        var length = block.map(function (w) { return w.text; }).join(" ").length;
        var last = block[block.length - 1].text;
        var c = 100 + 40 * length * length / (room * room);
        if (j < phrase.length) {
          if (/[,;:]$/.test(last)) {
            c -= 15;
          }
          if (leans(last)) {
            c += rules.maxWords <= 3 ? 90 : 30;
          }
        }
        if (block.length === 1 && phrase.length > 1 && rules.maxWords > 1) {
          c += 60;
        }
        if (cost[i] + c < cost[j]) {
          cost[j] = cost[i] + c;
          from[j] = i;
        }
      }
    }
    var blocks = [];
    for (var k = phrase.length; k > 0; k = from[k]) {
      blocks.unshift(phrase.slice(from[k], k));
    }
    return blocks;
  }

  // Words -> captions: hard cuts at pauses (pauseBreak) and sentence
  // ends, splitPhrase inside each phrase, then the timing -- each caption
  // lingers a little after its last word, lasts at least minDuration,
  // never runs into the next one, and a hole shorter than CHAIN_GAP is
  // closed so the text doesn't blink off between captions.
  // Returns [{ text ("\r" between lines), start, end, words }].
  function buildCaptions(words, rules) {
    var phrases = [];
    var current = [];
    words.forEach(function (word) {
      var previous = current[current.length - 1];
      if (previous && (word.start - previous.end >= rules.pauseBreak || (rules.bySentence !== false && previous.eos))) {
        phrases.push(current);
        current = [];
      }
      current.push(word);
    });
    if (current.length) {
      phrases.push(current);
    }
    var captions = [];
    phrases.forEach(function (phrase) {
      splitPhrase(phrase, rules).forEach(function (block) {
        var texts = block.map(function (w) { return w.text; });
        var lines = wrapLines(texts, rules.maxChars, rules.maxLines) || [texts.join(" ")];
        captions.push({
          text: lines.join("\r"),
          start: block[0].start,
          end: block[block.length - 1].end,
          words: block.map(function (w) { return { text: w.text, start: w.start, end: w.end, eos: !!w.eos }; })
        });
      });
    });
    captions.forEach(function (caption, i) {
      var next = captions[i + 1];
      var limit = next ? next.start : Infinity;
      var end = Math.max(caption.end + rules.linger, caption.start + rules.minDuration);
      end = Math.min(end, caption.start + Math.max(rules.maxDuration, caption.end - caption.start), limit);
      if (end <= caption.start) {
        end = caption.start + 0.05;
      }
      if (next && next.start - end < CHAIN_GAP) {
        end = next.start;
      }
      caption.start = round3(caption.start);
      caption.end = round3(end);
    });
    return captions;
  }

  // ---------------------------------------------------------------- highlight

  // Words that never carry a caption: articles, pronouns, prepositions,
  // auxiliaries, fillers -- PT, EN, ES.
  var FUNCTION_WORDS = {};
  ("a o as os um uma uns umas de da do das dos em na no nas nos e ou que se com por pra pro para ao aos à às mas " +
   "meu minha meus minhas seu sua seus suas teu tua nosso nossa eu tu ele ela nós eles elas você vocês me te lhe " +
   "isso isto aquilo esse essa este esta aquele aquela é são era foi ser estar está estou estão estava tem ter tenho " +
   "tinha há vai vou vamos faz fiz não sim já também muito mais menos bem só então quando como onde porque pois até " +
   "sobre entre lá aqui ali tipo coisa gente aí né tá cá dá " +
   "the an of to and or in on at for with from by as is are was were be been am do does did have has had i you he " +
   "she it we they me him her us them my your his its our their this that these those so but if then than just " +
   "really very can could will would should not no yes there here what which who how when where why all about into " +
   "out up get got like i'm it's that's don't " +
   "el la los las y en del al con un una unos unas su sus es son fue lo le les mi tu yo pero muy más por como cuando donde").split(" ").forEach(function (w) {
    FUNCTION_WORDS[w] = true;
  });
  var LEAD_WORDS = { e: 1, mas: 1, que: 1, porque: 1, pois: 1, se: 1, quando: 1, entao: 1, "então": 1, ou: 1, and: 1, but: 1, so: 1, because: 1, y: 1, pero: 1 };
  var NUMBER_WORDS = /^(dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|vinte|trinta|cem|cento|mil|milhão|milhões|bilhão|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|hundred|thousand|million|billion|dos|tres|cuatro|cinco|diez|cien|mil|millón)$/;

  function bare(text) {
    return String(text || "").toLocaleLowerCase("pt-BR").replace(/’/g, "'").replace(/[^0-9a-zà-ÿ'-]/g, "");
  }

  function isNumberWord(b) {
    return /\d/.test(b) || NUMBER_WORDS.test(b);
  }

  // How good a word is as the highlight (0 = never): long content words,
  // numbers, a stressed end ("!", "?", last word), words in CAPS.
  function highlightScore(words, i) {
    var raw = String(words[i].text || "");
    var b = bare(raw);
    if (!b || FUNCTION_WORDS[b]) {
      return 0;
    }
    var s = 10 + Math.min(b.length, 11) * 2;
    if (isNumberWord(b)) { s += 30; }
    if (/[!?]$/.test(raw)) { s += 8; }
    if (b.length <= 3 && !isNumberWord(b)) { s -= 6; }
    if (i === words.length - 1) { s += 6; }
    if (b.length > 5 && /(ar|er|ir|ing)$/.test(b)) { s -= 4; } // verbs a bit less than nouns/adjectives
    if (raw.length > 1 && raw === raw.toLocaleUpperCase("pt-BR") && /[A-ZÀ-Ý]/.test(raw)) { s += 6; }
    return s;
  }

  // The highlighted word(s) of a caption -- the best one, made a pair
  // when its neighbour is a number ("30 mil") or another short content
  // word; it prefers leaving 1-3 small words above and below.
  function pickHighlight(words, maxPre, maxPost) {
    var best = -1;
    var bestScore = -1;
    for (var i = 0; i < words.length; i += 1) {
      var s = highlightScore(words, i);
      if (s > 0) {
        var pre = i;
        var post = words.length - 1 - i;
        s += (pre > maxPre || post > maxPost ? -12 : 0) + (pre >= 1 && post >= 1 ? 5 : 0);
      }
      if (s >= bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0 || bestScore <= 0) {
      return [words.length - 1];
    }
    var out = [best];
    var here = bare(words[best].text);
    if (isNumberWord(here) && best + 1 < words.length && highlightScore(words, best + 1) > 0) {
      out.push(best + 1);
    } else if (best > 0 && isNumberWord(bare(words[best - 1].text))) {
      out.unshift(best - 1);
    } else if (words.length >= 4) {
      var j = best + 1 < words.length && highlightScore(words, best + 1) >= 20 ? best + 1 : (best > 0 && highlightScore(words, best - 1) >= 20 ? best - 1 : -1);
      if (j >= 0 && (here + bare(words[j].text)).length <= 12) {
        out.push(j);
        out.sort(function (x, y) { return x - y; });
      }
    }
    return out;
  }

  // Captions -> Reels / Viral captions: every caption gets its
  // highlighted word(s) (words[i].accent) and a variant number (styles
  // alternate colors between captions). A caption too long for the
  // small-words-around-a-big-word look is cut where it reads best: at a
  // sentence end or comma, before "e / mas / que...", never right after
  // a leaning word, both halves close in time.
  function planHighlights(captions, P) {
    var maxWords = (P && P.maxWords) || 7;
    var maxPre = (P && P.maxPre) || 3;
    var maxPost = (P && P.maxPost) || 4;
    var out = [];
    function emit(words, start, end) {
      var picked = pickHighlight(words, maxPre, maxPost);
      var marked = words.map(function (w, i) {
        return { text: w.text, start: w.start, end: w.end, accent: picked.indexOf(i) >= 0 };
      });
      if (P && P.period) {
        var last = picked[picked.length - 1];
        if (!/[?!]$/.test(marked[last].text)) {
          marked[last].text = marked[last].text.replace(/[.,;:…]+$/, "") + ".";
        }
      }
      if (P && P.preCase) {
        for (var i = 0; i < picked[0]; i += 1) {
          marked[i].text = applyCase(marked[i].text, P.preCase);
        }
      }
      out.push({ start: start, end: end, words: marked, variant: out.length, text: marked.map(function (w) { return w.text; }).join(" ") });
    }
    function split(words, start, end) {
      if (!words.length) {
        return;
      }
      var cutNeeded = words.length > maxWords;
      if (!cutNeeded && words.length >= 4) {
        var picked = pickHighlight(words, maxPre, maxPost);
        cutNeeded = picked[0] - maxPre >= 2 || words.length - 1 - picked[picked.length - 1] - maxPost >= 2;
      }
      if (!cutNeeded && words.length >= 6 && words[words.length - 1].end - words[0].start > 3.2) {
        cutNeeded = true;
      }
      if (!cutNeeded) {
        emit(words, start, end);
        return;
      }
      var n = words.length;
      var cut = -1;
      var best = Infinity;
      for (var k = 2; k <= n - 2; k += 1) {
        var dA = words[k - 1].end - words[0].start;
        var dB = words[n - 1].end - words[k].start;
        var prev = words[k - 1];
        var c = Math.abs(dA - dB) / Math.max(0.1, dA + dB) * 4 + Math.abs(k - n / 2) * 0.3;
        c += prev.eos || /[.!?]$/.test(prev.text) ? -5 : (prev.comma || /[,;:]$/.test(prev.text) ? -3.5 : 0);
        c += FUNCTION_WORDS[bare(prev.text)] ? 3 : 0;
        c += LEAD_WORDS[bare(words[k].text)] ? -1.5 : 0;
        c += /^(a|o|as|os|um|uma|uns|umas|the|an|el|la|los|las|un|una)$/.test(bare(words[k].text)) ? 2 : 0;
        c += dA < 0.8 || dB < 0.8 ? 4 : 0;
        c += (k > maxWords ? 5 : 0) + (n - k > maxWords ? 5 : 0);
        if (c < best) {
          best = c;
          cut = k;
        }
      }
      if (cut < 0) {
        emit(words, start, end);
        return;
      }
      split(words.slice(0, cut), start, words[cut].start);
      split(words.slice(cut), words[cut].start, end);
    }
    captions.forEach(function (c) {
      split(c.words.slice(), c.start, c.end);
    });
    return out;
  }

  // Captions edited by hand (Captions › Review): the empty ones go, the
  // rest in time order. A changed one (c.dirty) gets fresh times from its
  // words with the same linger / min / max / chain rules as
  // buildCaptions; untouched ones keep theirs; none overlaps the next.
  // Reels / Viral (P): a caption left without a highlighted word gets one
  // picked, variants follow the order. Simple styles: lines re-wrapped.
  function finishEdited(captions, rules, P, viral) {
    var list = captions.filter(function (c) { return c.words && c.words.length; }).map(function (c) {
      var start = Infinity;
      var end = 0;
      var words = c.words.map(function (w) {
        start = Math.min(start, w.start);
        end = Math.max(end, w.end);
        return { text: w.text, start: w.start, end: w.end, accent: !!w.accent, eos: !!w.eos };
      });
      return { start: c.dirty ? start : c.start, end: c.dirty ? end : c.end, dirty: !!c.dirty, words: words };
    });
    list.sort(function (a, b) { return a.start - b.start; });
    list.forEach(function (c, i) {
      var next = list[i + 1];
      var end = c.end;
      if (c.dirty) {
        end = Math.max(c.end + rules.linger, c.start + rules.minDuration);
        end = Math.min(end, c.start + Math.max(rules.maxDuration, c.end - c.start));
        if (next && next.start - end < CHAIN_GAP) {
          end = next.start;
        }
      }
      if (next) {
        end = Math.min(end, next.start);
      }
      if (end <= c.start) {
        end = c.start + 0.05;
      }
      c.start = round3(c.start);
      c.end = round3(end);
      var texts = c.words.map(function (w) { return w.text; });
      if (viral) {
        if (!c.words.some(function (w) { return w.accent; })) {
          pickHighlight(c.words, (P && P.maxPre) || 3, (P && P.maxPost) || 4).forEach(function (k) { c.words[k].accent = true; });
        }
        c.variant = i;
        c.text = texts.join(" ");
      } else {
        c.text = (wrapLines(texts, rules.maxChars, rules.maxLines) || [texts.join(" ")]).join("\r");
      }
      delete c.dirty;
    });
    return list;
  }

  return {
    finishEdited: finishEdited,
    pickHighlight: pickHighlight,
    planHighlights: planHighlights,
    readWav16: readWav16,
    speechActivity: speechActivity,
    isSilent: isSilent,
    wordsFromWhisper: wordsFromWhisper,
    cleanWords: cleanWords,
    captionRules: captionRules,
    defaultRules: defaultRules,
    applyCase: applyCase,
    prepareWords: prepareWords,
    offsetCaptions: offsetCaptions,
    wrapLines: wrapLines,
    buildCaptions: buildCaptions
  };
}));

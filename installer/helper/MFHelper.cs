// Mótion Film helper (Windows): the global shortcut + the Wheel.
//
// Started by the main panel (client/wheel-runner.js) with Node, talks
// over stdin / stdout, one command per line:
//   in:  hotkey <mods> <vk> | hotkey off | theme <accent #hex> <panel #hex>
//        wheel <json {slices:[{id,label,group,children:[{id,label}]}]}>
//        show | done <message> | error <message> | quit
//   out: ready | hotkey ok|busy <mods> <vk> | hotkey off | pick <id>
//        config | closed
// The shortcut (RegisterHotKey, mods: 1 Alt, 2 Ctrl, 4 Shift, 8 Win) is
// only held while After Effects is the foreground app, so it never
// steals the keys from other programs.
//
// The Wheel opens centered on the mouse: 2..8 slices around a hub (top
// first, clockwise). Hovering a group slice opens its own 2..8 slices in
// an outer ring around it. A click (or 1-8 for the inner slices) picks;
// Esc, a right click or clicking elsewhere closes; the gear in the hub
// asks the panel to open the "MF - Wheel" settings window. A pick hides
// the wheel and hands focus back to After Effects right away; only an
// error shows it again, without taking focus, for a moment.
// It's a layered window (per-pixel alpha), so the round shape and the
// soft edges are real. Exits when stdin closes (panel or AE closed).
//
// Built with the .NET Framework csc by installer\build-helper.ps1.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Native
{
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int CX, CY; public SIZE(int x, int y) { CX = x; CY = y; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] public struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
    [DllImport("user32.dll")] public static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pprSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);
}

class WItem
{
    public string Id = "", Label = "";
    public bool Group;
    public List<WItem> Kids = new List<WItem>();
}

class Host : Form
{
    const int WM_HOTKEY = 0x0312;
    const int HOTKEY_ID = 0x4D46;
    const uint MOD_NOREPEAT = 0x4000;

    uint mods = 2, vk = 9;         // Ctrl + Tab until the panel says otherwise
    bool wanted = false;           // the panel turned the shortcut on
    bool held = false;             // registered right now
    public Color Accent = Color.FromArgb(0, 240, 17);
    public Color Panel = Color.FromArgb(33, 33, 33);
    public List<WItem> Slices = new List<WItem>();
    Wheel wheel;
    readonly System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();

    public Host()
    {
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        Opacity = 0;
        Size = new Size(1, 1);
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-32000, -32000);
        watch.Interval = 150;
        watch.Tick += delegate { Follow(); };
        // never shown: create the window handle now (hotkey messages,
        // BeginInvoke from the stdin thread)
        IntPtr handle = Handle;
    }

    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        watch.Start();
        var reader = new Thread(ReadInput) { IsBackground = true };
        reader.Start();
        Send("ready");
    }

    // a window app has no console: write the pipe directly, UTF-8
    static readonly System.IO.StreamWriter output = new System.IO.StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    static readonly object outputLock = new object();

    public static void Send(string line)
    {
        try { lock (outputLock) { output.Write(line + "\n"); output.Flush(); } } catch { Environment.Exit(0); }
    }

    void ReadInput()
    {
        var input = new System.IO.StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = input.ReadLine()) != null)
        {
            string l = line.Trim();
            if (l.Length == 0) { continue; }
            try { BeginInvoke(new Action(() => Command(l))); } catch { break; }
        }
        try { BeginInvoke(new Action(Quit)); } catch { Environment.Exit(0); }
    }

    void Command(string line)
    {
        int sp = line.IndexOf(' ');
        string cmd = sp < 0 ? line : line.Substring(0, sp);
        string rest = sp < 0 ? "" : line.Substring(sp + 1);
        switch (cmd)
        {
            case "hotkey":
                if (rest == "off") { wanted = false; Release(); Send("hotkey off"); return; }
                var p = rest.Split(' ');
                uint m, v;
                if (p.Length < 2 || !uint.TryParse(p[0], out m) || !uint.TryParse(p[1], out v)) { return; }
                Release();
                mods = m; vk = v; wanted = true;
                // try it once now (also when After Effects isn't in front) to
                // tell the panel whether another program owns these keys
                bool ok = Native.RegisterHotKey(Handle, HOTKEY_ID, mods | MOD_NOREPEAT, vk);
                if (ok) { held = true; }
                Send("hotkey " + (ok ? "ok" : "busy") + " " + mods + " " + vk);
                Follow();
                break;
            case "theme":
                var t = rest.Split(' ');
                if (t.Length >= 2) { Accent = Hex(t[0], Accent); Panel = Hex(t[1], Panel); }
                break;
            case "wheel":
                try { Slices = ParseSlices(rest); } catch { }
                break;
            case "show": Open(rest == "pin"); break; // "show pin" (dev): stays open without focus
            case "snapshot": if (wheel != null) { wheel.Snapshot(rest); } break; // dev: the wheel as a PNG
            case "done": if (wheel != null) { wheel.Finish(rest, false); } break;
            case "error": if (wheel != null) { wheel.Finish(rest, true); } break;
            case "quit": Quit(); break;
        }
    }

    static List<WItem> ParseSlices(string json)
    {
        var list = new List<WItem>();
        var root = new JavaScriptSerializer().DeserializeObject(json) as IDictionary<string, object>;
        if (root == null || !root.ContainsKey("slices")) { return list; }
        foreach (object o in (IEnumerable)root["slices"])
        {
            var it = ToItem(o);
            if (it != null) { list.Add(it); }
        }
        return list;
    }

    static WItem ToItem(object o)
    {
        var d = o as IDictionary<string, object>;
        if (d == null) { return null; }
        var it = new WItem();
        if (d.ContainsKey("id") && d["id"] != null) { it.Id = d["id"].ToString(); }
        if (d.ContainsKey("label") && d["label"] != null) { it.Label = d["label"].ToString(); }
        it.Group = d.ContainsKey("group") && d["group"] is bool && (bool)d["group"];
        if (it.Group && d.ContainsKey("children") && d["children"] is IEnumerable)
        {
            foreach (object c in (IEnumerable)d["children"])
            {
                var k = ToItem(c);
                if (k != null) { k.Group = false; it.Kids.Add(k); }
            }
        }
        return it;
    }

    static Color Hex(string s, Color fallback)
    {
        try { return ColorTranslator.FromHtml(s); } catch { return fallback; }
    }

    static bool AfterEffectsInFront()
    {
        try
        {
            uint pid;
            Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out pid);
            string name = Process.GetProcessById((int)pid).ProcessName;
            return name.Equals("AfterFX", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    // Hold the shortcut only while After Effects is in front.
    void Follow()
    {
        bool want = wanted && wheel == null && AfterEffectsInFront();
        if (want && !held) { held = Native.RegisterHotKey(Handle, HOTKEY_ID, mods | MOD_NOREPEAT, vk); }
        else if (!want && held) { Release(); }
    }

    void Release()
    {
        if (held) { Native.UnregisterHotKey(Handle, HOTKEY_ID); held = false; }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && (int)m.WParam == HOTKEY_ID) { Open(false); return; }
        base.WndProc(ref m);
    }

    void Open(bool pin)
    {
        if (wheel != null) { wheel.Activate(); return; }
        IntPtr back = Native.GetForegroundWindow();
        var w = new Wheel(this, back);
        w.Pinned = pin;
        wheel = w;
        w.FormClosed += delegate
        {
            wheel = null;
            Send("closed");
            if (!w.HandedBack && back != IntPtr.Zero) { Native.SetForegroundWindow(back); }
        };
        w.Show();
        w.Activate();
        Native.SetForegroundWindow(w.Handle);
    }

    void Quit()
    {
        Release();
        if (wheel != null) { wheel.Close(); }
        Application.Exit();
    }
}

class Wheel : Form
{
    const int WS_EX_LAYERED = 0x80000, WS_EX_TOOLWINDOW = 0x80, WS_EX_TOPMOST = 0x8;

    readonly Host host;
    readonly IntPtr back;
    readonly List<WItem> slices;
    readonly float s;
    // radii: hub, inner ring in/out, outer (group) ring in/out
    readonly float R0, R1, R2, R3, R4;
    readonly int size;
    readonly float cx, cy;
    int hover = -1;        // inner slice under the mouse
    int open = -1;         // group whose outer ring is showing
    int child = -1;        // outer slice under the mouse
    bool gearHover;
    bool waiting;          // picked: hidden until the panel answers
    bool quiet;            // shown again for an error: don't take focus
    public bool HandedBack;
    public bool Pinned;
    string status = "";
    readonly System.Windows.Forms.Timer closer = new System.Windows.Forms.Timer();

    public Wheel(Host host, IntPtr back)
    {
        this.host = host;
        this.back = back;
        slices = host.Slices;
        using (var g = CreateGraphics()) { s = g.DpiX / 96f; }
        R0 = 40 * s; R1 = 48 * s; R2 = 128 * s; R3 = 136 * s; R4 = 200 * s;
        size = (int)Math.Ceiling(2 * (R4 + 12 * s));
        cx = size / 2f; cy = size / 2f;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        StartPosition = FormStartPosition.Manual;
        Size = new Size(size, size);
        // centered on the mouse, kept on the screen
        Point c = Cursor.Position;
        Rectangle area = Screen.FromPoint(c).WorkingArea;
        int x = Math.Max(area.Left, Math.Min(c.X - size / 2, area.Right - size));
        int y = Math.Max(area.Top, Math.Min(c.Y - size / 2, area.Bottom - size));
        Location = new Point(x, y);
        closer.Tick += delegate { closer.Stop(); Close(); };
    }

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST; return cp; }
    }

    protected override bool ShowWithoutActivation { get { return quiet; } }

    protected override void OnShown(EventArgs e) { base.OnShown(e); Render(); }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        if (!waiting && !closer.Enabled && !Pinned) { Close(); }
    }

    // ------------------------------------------------------------ geometry

    float Span { get { return 360f / Math.Max(1, slices.Count); } }
    float CenterAngle(int i) { return -90f + i * Span; }

    static float Norm(float a) { a %= 360f; if (a < 0) { a += 360f; } return a; }

    // the outer ring of a group: one slice per child, centered on the parent
    float ChildSpan(WItem g) { return Math.Min(46f, 320f / Math.Max(1, g.Kids.Count)); }
    float ChildCenter(int parent, int j)
    {
        var g = slices[parent];
        return CenterAngle(parent) + (j - (g.Kids.Count - 1) / 2f) * ChildSpan(g);
    }

    void HitTest(Point p)
    {
        float dx = p.X - cx, dy = p.Y - cy;
        float d = (float)Math.Sqrt(dx * dx + dy * dy);
        float a = (float)(Math.Atan2(dy, dx) * 180 / Math.PI);
        hover = -1;
        child = -1;
        gearHover = false;
        if (slices.Count == 0) { return; }
        if (d < R1)
        {
            float gx = p.X - cx, gy = p.Y - (cy + 16 * s);
            gearHover = gx * gx + gy * gy < (10 * s) * (10 * s);
            return;
        }
        if (d <= R2 + 3 * s)
        {
            hover = (int)(Norm(a - CenterAngle(0) + Span / 2) / Span) % slices.Count;
            open = slices[hover].Group && slices[hover].Kids.Count > 0 ? hover : -1;
            return;
        }
        if (open >= 0 && d <= R4 + 24 * s)
        {
            var g = slices[open];
            float cs = ChildSpan(g);
            float total = cs * g.Kids.Count;
            float rel = Norm(a - CenterAngle(open) + 180f) - 180f; // -180..180 from the parent's middle
            if (Math.Abs(rel) <= total / 2)
            {
                child = Math.Min(g.Kids.Count - 1, (int)((rel + total / 2) / cs));
            }
        }
    }

    // ------------------------------------------------------------ input

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (waiting) { return; }
        int h = hover, o = open, c = child;
        bool gh = gearHover;
        HitTest(e.Location);
        if (h != hover || o != open || c != child || gh != gearHover) { Render(); }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (waiting) { return; }
        if (e.Button == MouseButtons.Right) { Close(); return; }
        HitTest(e.Location);
        if (gearHover) { Host.Send("config"); Close(); return; }
        if (child >= 0 && open >= 0) { Pick(slices[open].Kids[child]); return; }
        if (hover >= 0)
        {
            if (!slices[hover].Group) { Pick(slices[hover]); }
            return;
        }
        float dx = e.X - cx, dy = e.Y - cy;
        if (dx * dx + dy * dy < R1 * R1 || open < 0) { Close(); }
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Escape) { Close(); return; }
        int n = -1;
        if (e.KeyCode >= Keys.D1 && e.KeyCode <= Keys.D8) { n = e.KeyCode - Keys.D1; }
        if (e.KeyCode >= Keys.NumPad1 && e.KeyCode <= Keys.NumPad8) { n = e.KeyCode - Keys.NumPad1; }
        if (n < 0) { return; }
        if (open >= 0 && n < slices[open].Kids.Count) { Pick(slices[open].Kids[n]); return; }
        if (n >= slices.Count) { return; }
        if (slices[n].Group) { open = n; hover = n; Render(); } else { Pick(slices[n]); }
    }

    void Pick(WItem it)
    {
        waiting = true;
        Host.Send("pick " + it.Id);
        // give After Effects the focus back while this process still owns
        // the foreground: the timeline is live again without a click
        if (back != IntPtr.Zero) { HandedBack = Native.SetForegroundWindow(back); }
        Hide();
        closer.Interval = 5000; // the panel never answered: just go
        closer.Start();
    }

    public void Finish(string message, bool error)
    {
        closer.Stop();
        waiting = false;
        if (!error) { Close(); return; }
        status = message;
        quiet = true;
        hover = -1; child = -1;
        Show();
        Render();
        closer.Interval = 1800;
        closer.Start();
    }

    // ------------------------------------------------------------ drawing

    static Color A(Color c, int alpha) { return Color.FromArgb(alpha, c.R, c.G, c.B); }
    static Color Mix(Color a, Color b, float t)
    {
        return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
    }
    static bool Light(Color c) { return c.R * 0.299 + c.G * 0.587 + c.B * 0.114 > 128; }

    // A ring slice whose four corners are rounded with radius `round`: each
    // corner is a small circle touching the arc and the straight edge of
    // the gap (which runs parallel to the radius, gapPx / 2 away from it).
    // `round` shrinks until it fits a narrow or thin slice.
    GraphicsPath Sector(float rIn, float rOut, float center, float span, float gapPx, float round)
    {
        float h = gapPx / 2f;
        float a0 = center - span / 2, a1 = center + span / 2;
        float rc = Math.Min(round, (rOut - rIn) / 2f - 0.5f);
        PointF[] c = null;
        for (int tries = 0; tries < 12 && rc > 0.4f; tries++, rc *= 0.75f)
        {
            c = Corners(rIn, rOut, a0, a1, h, rc);
            if (c != null) { break; }
        }
        var p = new GraphicsPath();
        if (c == null)
        {
            float gOut = gapPx / rOut * 180f / (float)Math.PI;
            float gIn = gapPx / rIn * 180f / (float)Math.PI;
            p.AddArc(cx - rOut, cy - rOut, 2 * rOut, 2 * rOut, a0 + gOut / 2, span - gOut);
            p.AddArc(cx - rIn, cy - rIn, 2 * rIn, 2 * rIn, a1 - gIn / 2, -(span - gIn));
            p.CloseFigure();
            return p;
        }
        // c: per corner (outer start, outer end, inner end, inner start)
        // the fillet center, then its angle on the ring (in degrees, as X)
        Fillet(p, c[0], rc, c[1].X, rOut, a0, h, true);
        p.AddArc(cx - rOut, cy - rOut, 2 * rOut, 2 * rOut, c[1].X, c[3].X - c[1].X);
        Fillet(p, c[2], rc, c[3].X, rOut, a1, h, false);
        Fillet(p, c[4], rc, c[5].X, rIn, a1, h, true);
        p.AddArc(cx - rIn, cy - rIn, 2 * rIn, 2 * rIn, c[5].X, c[7].X - c[5].X);
        Fillet(p, c[6], rc, c[7].X, rIn, a0, h, false);
        p.CloseFigure();
        return p;
    }

    // fillet centers (world) + their angles; null when rc doesn't fit
    PointF[] Corners(float rIn, float rOut, float a0, float a1, float h, float rc)
    {
        var o = new PointF[8];
        float[] dist = { rOut - rc, rOut - rc, rIn + rc, rIn + rc };
        float[] edge = { a0, a1, a1, a0 };
        float[] side = { 1, -1, -1, 1 };
        for (int k = 0; k < 4; k++)
        {
            float y = h + rc;
            if (dist[k] <= y) { return null; }
            float x = (float)Math.Sqrt(dist[k] * dist[k] - y * y);
            float ang = edge[k] + side[k] * (float)(Math.Atan2(y, x) * 180 / Math.PI);
            double rad = ang * Math.PI / 180;
            o[2 * k] = new PointF(cx + (float)Math.Cos(rad) * dist[k], cy + (float)Math.Sin(rad) * dist[k]);
            o[2 * k + 1] = new PointF(ang, 0);
        }
        // the outer arc and the inner arc must keep a positive length
        if (o[3].X - o[1].X < 0.5f || o[5].X - o[7].X < 0.5f) { return null; }
        return o;
    }

    // one rounded corner: from the straight edge to the ring (lineFirst) or
    // back. The touch point on the edge is the foot of the fillet center on
    // the gap's edge line; on the ring it lies along the center's angle.
    void Fillet(GraphicsPath p, PointF f, float rc, float ringAng, float ringR, float edgeAng, float h, bool lineFirst)
    {
        double er = edgeAng * Math.PI / 180;
        float ux = (float)Math.Cos(er), uy = (float)Math.Sin(er);
        // distance of the fillet center along the radius direction
        float along = (f.X - cx) * ux + (f.Y - cy) * uy;
        float sign = Math.Sign((f.X - cx) * -uy + (f.Y - cy) * ux);
        var onEdge = new PointF(cx + ux * along + -uy * sign * h, cy + uy * along + ux * sign * h);
        double rr = ringAng * Math.PI / 180;
        var onRing = new PointF(cx + (float)Math.Cos(rr) * ringR, cy + (float)Math.Sin(rr) * ringR);
        PointF from = lineFirst ? onEdge : onRing, to = lineFirst ? onRing : onEdge;
        float s0 = (float)(Math.Atan2(from.Y - f.Y, from.X - f.X) * 180 / Math.PI);
        float s1 = (float)(Math.Atan2(to.Y - f.Y, to.X - f.X) * 180 / Math.PI);
        float sweep = s1 - s0;
        while (sweep > 180) { sweep -= 360; }
        while (sweep <= -180) { sweep += 360; }
        p.AddArc(f.X - rc, f.Y - rc, 2 * rc, 2 * rc, s0, sweep);
    }

    void Label(Graphics g, string text, float angle, float r, float width, Font font, Color color)
    {
        float rad = angle * (float)Math.PI / 180f;
        float x = cx + (float)Math.Cos(rad) * r, y = cy + (float)Math.Sin(rad) * r;
        var box = new RectangleF(x - width / 2, y - 18 * s, width, 36 * s);
        using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisWord })
        using (var b = new SolidBrush(color))
        {
            g.DrawString(text, font, b, box, sf);
        }
    }

    public void Snapshot(string path)
    {
        try
        {
            using (var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                    g.Clear(Color.Transparent);
                    Draw(g);
                }
                bmp.Save(path, ImageFormat.Png);
            }
            Host.Send("snapshot ok");
        }
        catch (Exception e) { Host.Send("snapshot error " + e.Message.Replace('\n', ' ')); }
    }

    void Render()
    {
        if (!IsHandleCreated) { return; }
        using (var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                g.Clear(Color.Transparent);
                Draw(g);
            }
            Push(bmp);
        }
    }

    void Draw(Graphics g)
    {
        Color panel = host.Panel;
        Color accent = host.Accent;
        Color raised = Mix(panel, Color.White, 0.09f);
        Color line = Mix(panel, Color.White, 0.16f);
        Color text = Color.FromArgb(240, 240, 244);
        Color muted = Color.FromArgb(150, 150, 162);
        Color ink = Light(accent) ? Color.FromArgb(17, 17, 17) : Color.White;

        // an invisible disc catches the mouse over the whole wheel (fully
        // transparent pixels of a layered window let clicks through)
        using (var catcher = new SolidBrush(Color.FromArgb(1, 0, 0, 0)))
        {
            float r = open >= 0 ? R4 + 24 * s : R2 + 24 * s;
            g.FillEllipse(catcher, cx - r, cy - r, 2 * r, 2 * r);
        }
        // a dark disc behind the slices, clearly darker than them so the
        // gaps and the rounded corners still read
        Color back = Mix(panel, Color.Black, 0.5f);
        using (var disc = new GraphicsPath())
        using (var b = new SolidBrush(A(back, 240)))
        {
            float r = R2 + 6 * s;
            disc.AddEllipse(cx - r, cy - r, 2 * r, 2 * r);
            Shadow(g, disc);
            g.FillPath(b, disc);
        }

        using (var fMain = new Font("Segoe UI Semibold", 9f))
        using (var fKid = new Font("Segoe UI Semibold", 8.5f))
        {
            int n = slices.Count;
            for (int i = 0; i < n; i++)
            {
                bool on = i == hover || (i == open && child < 0 && hover == open);
                bool parent = i == open;
                Color fill = on ? accent : (parent ? Mix(raised, accent, 0.28f) : raised);
                using (var path = Sector(R1, R2, CenterAngle(i), Span, 5 * s, 11 * s))
                using (var b = new SolidBrush(A(fill, 250)))
                {
                    g.FillPath(b, path);
                }
                float mid = (R1 + R2) / 2f;
                float chord = (float)(2 * mid * Math.Sin(Math.Min(Span, 150f) / 2 * Math.PI / 180)) * 0.86f;
                Label(g, slices[i].Label, CenterAngle(i), mid, Math.Min(chord, 92 * s), fMain, on ? ink : text);
                // a group: an accent line along its outer edge, clear of
                // the rounded corners
                if (slices[i].Group)
                {
                    using (var pen = new Pen(on ? A(ink, 200) : accent, 2.6f * s) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    {
                        float r = R2 - 5.5f * s;
                        float margin = (2 * s + 11 * s + 5 * s) / r * 180f / (float)Math.PI;
                        float len = Span - 2 * margin;
                        if (len > 4) { g.DrawArc(pen, cx - r, cy - r, 2 * r, 2 * r, CenterAngle(i) - len / 2, len); }
                    }
                }
            }

            // the open group's own slices, around it
            if (open >= 0 && open < n)
            {
                var grp = slices[open];
                float cs = ChildSpan(grp);
                // the same dark backing behind the group's ring
                float pad = 6 * s / R3 * 180f / (float)Math.PI;
                using (var band = Sector(R3 - 6 * s, R4 + 6 * s, CenterAngle(open), cs * grp.Kids.Count + 2 * pad, 0, 16 * s))
                using (var b = new SolidBrush(A(back, 240)))
                {
                    Shadow(g, band);
                    g.FillPath(b, band);
                }
                for (int j = 0; j < grp.Kids.Count; j++)
                {
                    bool on = j == child;
                    using (var path = Sector(R3, R4, ChildCenter(open, j), cs, 5 * s, 9 * s))
                    using (var b = new SolidBrush(A(on ? accent : raised, 250)))
                    {
                        g.FillPath(b, path);
                    }
                    float mid = (R3 + R4) / 2f;
                    float chord = (float)(2 * mid * Math.Sin(cs / 2 * Math.PI / 180)) * 0.9f;
                    Label(g, grp.Kids[j].Label, ChildCenter(open, j), mid, Math.Max(chord, 54 * s), fKid, on ? ink : text);
                }
            }

            // hub: what's under the mouse (or a message), and the gear
            using (var hub = new SolidBrush(Mix(panel, Color.Black, 0.25f)))
            using (var pen = new Pen(line, 1f))
            {
                g.FillEllipse(hub, cx - R0, cy - R0, 2 * R0, 2 * R0);
                g.DrawEllipse(pen, cx - R0, cy - R0, 2 * R0, 2 * R0);
            }
            string hubText = status.Length > 0 ? status
                : (child >= 0 && open >= 0 ? slices[open].Kids[child].Label
                : (hover >= 0 ? slices[hover].Label : (n == 0 ? "No slices" : "Mótion")));
            Color hubColor = status.Length > 0 ? Color.FromArgb(234, 160, 177) : (hover >= 0 || child >= 0 ? text : muted);
            using (var f = new Font("Segoe UI Semibold", 8f))
            using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter })
            using (var b = new SolidBrush(hubColor))
            {
                g.DrawString(hubText, f, b, new RectangleF(cx - R0 + 5 * s, cy - 20 * s, 2 * R0 - 10 * s, 28 * s), sf);
            }
            DrawGear(g, cx, cy + 16 * s, 5.5f * s, gearHover ? accent : muted);
        }
    }

    // a short soft drop shadow under one slice
    void Shadow(Graphics g, GraphicsPath path)
    {
        var state = g.Save();
        for (int k = 3; k >= 1; k--)
        {
            using (var pen = new Pen(Color.FromArgb(22, 0, 0, 0), k * 2f * s) { LineJoin = LineJoin.Round })
            using (var b = new SolidBrush(Color.FromArgb(22, 0, 0, 0)))
            {
                g.ResetTransform();
                g.TranslateTransform(0, 1.5f * s);
                g.DrawPath(pen, path);
                g.FillPath(b, path);
            }
        }
        g.Restore(state);
    }

    void DrawGear(Graphics g, float x, float y, float r, Color c)
    {
        using (var pen = new Pen(c, 1.4f * s))
        {
            g.DrawEllipse(pen, x - r * 0.55f, y - r * 0.55f, r * 1.1f, r * 1.1f);
            for (int i = 0; i < 8; i++)
            {
                double a = i * Math.PI / 4;
                g.DrawLine(pen, x + (float)Math.Cos(a) * r * 0.75f, y + (float)Math.Sin(a) * r * 0.75f, x + (float)Math.Cos(a) * r * 1.1f, y + (float)Math.Sin(a) * r * 1.1f);
            }
        }
    }

    void Push(Bitmap bmp)
    {
        IntPtr screen = Native.GetDC(IntPtr.Zero);
        IntPtr mem = Native.CreateCompatibleDC(screen);
        IntPtr hbmp = bmp.GetHbitmap(Color.FromArgb(0));
        IntPtr old = Native.SelectObject(mem, hbmp);
        try
        {
            var sz = new Native.SIZE(bmp.Width, bmp.Height);
            var src = new Native.POINT(0, 0);
            var dst = new Native.POINT(Left, Top);
            var blend = new Native.BLENDFUNCTION { BlendOp = 0, BlendFlags = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };
            Native.UpdateLayeredWindow(Handle, screen, ref dst, ref sz, mem, ref src, 0, ref blend, 2);
        }
        finally
        {
            Native.ReleaseDC(IntPtr.Zero, screen);
            Native.SelectObject(mem, old);
            Native.DeleteObject(hbmp);
            Native.DeleteDC(mem);
        }
    }
}

static class Program
{
    [STAThread]
    static void Main()
    {
        try { Native.SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new Host());
    }
}

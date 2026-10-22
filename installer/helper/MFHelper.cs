// Mótion Film helper (Windows): the global shortcut + the Elastic popup.
//
// Started by the main panel (client/elastic.js) with Node, talks over
// stdin / stdout, one command per line:
//   in:  hotkey <mods> <vk> | hotkey off | theme <accent #hex> <panel #hex>
//        show | done <message> | error <message> | quit
//   out: ready | hotkey ok|busy <mods> <vk> | hotkey off | pick <kind> | closed
// The shortcut (RegisterHotKey, mods: 1 Alt, 2 Ctrl, 4 Shift, 8 Win) is
// only held while After Effects is the foreground app, so it never
// steals the keys from other programs. The popup opens at the mouse,
// shows Position / Scale / Rotation; 1-3 or a click picks, Esc or
// clicking elsewhere closes, and focus goes back to After Effects.
// Exits when stdin closes (panel or After Effects closed).
//
// Built with the .NET Framework csc by installer\build-helper.ps1 into
// motion-film\bin\win\MFHelper.exe.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Native
{
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}

class Host : Form
{
    const int WM_HOTKEY = 0x0312;
    const int HOTKEY_ID = 0x4D46;
    const uint MOD_NOREPEAT = 0x4000;

    uint mods = 2, vk = 76;        // Ctrl + L until the panel says otherwise
    bool wanted = false;           // the panel turned the shortcut on
    bool held = false;             // registered right now
    public Color Accent = Color.FromArgb(0, 240, 17);
    public Color Panel = Color.FromArgb(33, 33, 33);
    Popup popup;
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
            case "show": Open(); break;
            case "done": if (popup != null) { popup.Finish(rest, false); } break;
            case "error": if (popup != null) { popup.Finish(rest, true); } break;
            case "quit": Quit(); break;
        }
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
        bool want = wanted && popup == null && AfterEffectsInFront();
        if (want && !held) { held = Native.RegisterHotKey(Handle, HOTKEY_ID, mods | MOD_NOREPEAT, vk); }
        else if (!want && held) { Release(); }
    }

    void Release()
    {
        if (held) { Native.UnregisterHotKey(Handle, HOTKEY_ID); held = false; }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && (int)m.WParam == HOTKEY_ID) { Open(); return; }
        base.WndProc(ref m);
    }

    void Open()
    {
        if (popup != null) { popup.Activate(); return; }
        IntPtr back = Native.GetForegroundWindow();
        popup = new Popup(this, back);
        popup.FormClosed += delegate
        {
            popup = null;
            Send("closed");
            if (back != IntPtr.Zero) { Native.SetForegroundWindow(back); }
        };
        popup.Show();
        popup.Activate();
        Native.SetForegroundWindow(popup.Handle);
    }

    void Quit()
    {
        Release();
        if (popup != null) { popup.Close(); }
        Application.Exit();
    }
}

class Popup : Form
{
    static readonly string[] Kinds = { "position", "scale", "rotation" };
    static readonly string[] Labels = { "Position", "Scale", "Rotation" };

    readonly Host host;
    readonly float s;
    Rectangle[] buttons = new Rectangle[3];
    int hover = -1;
    bool busy;
    string status = "";
    bool statusError;
    readonly System.Windows.Forms.Timer closer = new System.Windows.Forms.Timer();

    public Popup(Host host, IntPtr back)
    {
        this.host = host;
        using (var g = CreateGraphics()) { s = g.DpiX / 96f; }
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        BackColor = host.Panel;
        Size = new Size(S(336), S(104));
        Font = new Font("Segoe UI", 9f);
        // at the mouse, inside the screen
        Point c = Cursor.Position;
        Rectangle area = Screen.FromPoint(c).WorkingArea;
        int x = Math.Max(area.Left + 8, Math.Min(c.X - Width / 2, area.Right - Width - 8));
        int y = Math.Max(area.Top + 8, Math.Min(c.Y - S(26), area.Bottom - Height - 8));
        Location = new Point(x, y);
        int bw = (Width - S(16) * 2 - S(8) * 2) / 3;
        for (int i = 0; i < 3; i++) { buttons[i] = new Rectangle(S(16) + i * (bw + S(8)), S(44), bw, S(44)); }
        closer.Tick += delegate { closer.Stop(); Close(); };
    }

    int S(float v) { return (int)Math.Round(v * s); }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int round = 2; // Windows 11 rounded corners (ignored elsewhere)
        try { Native.DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch { }
    }

    protected override bool ShowWithoutActivation { get { return false; } }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        if (!closer.Enabled) { Close(); }
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Escape) { Close(); return; }
        int n = -1;
        if (e.KeyCode >= Keys.D1 && e.KeyCode <= Keys.D3) { n = e.KeyCode - Keys.D1; }
        if (e.KeyCode >= Keys.NumPad1 && e.KeyCode <= Keys.NumPad3) { n = e.KeyCode - Keys.NumPad1; }
        if (n >= 0) { Pick(n); }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        int h = -1;
        for (int i = 0; i < 3; i++) { if (buttons[i].Contains(e.Location)) { h = i; } }
        if (h != hover) { hover = h; Cursor = h >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); }
    }

    protected override void OnMouseLeave(EventArgs e) { hover = -1; Invalidate(); }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        for (int i = 0; i < 3; i++) { if (buttons[i].Contains(e.Location)) { Pick(i); } }
    }

    void Pick(int n)
    {
        if (busy) { return; }
        busy = true;
        status = "Applying…";
        statusError = false;
        Invalidate();
        Host.Send("pick " + Kinds[n]);
    }

    public void Finish(string message, bool error)
    {
        busy = false;
        status = message;
        statusError = error;
        Invalidate();
        closer.Interval = error ? 1800 : 650;
        closer.Start();
    }

    static Color Mix(Color a, Color b, float t)
    {
        return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
    }

    static GraphicsPath Round(Rectangle r, int radius)
    {
        var p = new GraphicsPath();
        int d = radius * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        Color text = Color.FromArgb(242, 240, 245);
        Color muted = Color.FromArgb(145, 145, 159);
        Color dim = Color.FromArgb(96, 97, 108);
        Color raised = Mix(host.Panel, Color.White, 0.05f);
        Color line = Mix(host.Panel, Color.White, 0.12f);

        using (var pen = new Pen(line)) { g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1); }

        // header: wave mark, "Mótion Film Elastic", hint / status
        DrawWave(g, new Rectangle(S(16), S(13), S(16), S(14)), host.Accent, 1.6f * s);
        using (var bold = new Font("Segoe UI Semibold", 9.5f))
        {
            TextRenderer.DrawText(g, "Mótion Film", Font, new Point(S(38), S(12)), muted, TextFormatFlags.NoPadding);
            Size w = TextRenderer.MeasureText(g, "Mótion Film ", Font, Size.Empty, TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "Elastic", bold, new Point(S(38) + w.Width, S(11)), text, TextFormatFlags.NoPadding);
        }
        string right = status.Length > 0 ? status : "1–3 apply · Esc close";
        Color rc = status.Length > 0 ? (statusError ? Color.FromArgb(234, 160, 177) : host.Accent) : dim;
        using (var small = new Font("Segoe UI", 8f))
        {
            var box = new Rectangle(S(130), S(12), Width - S(130) - S(16), S(18));
            TextRenderer.DrawText(g, right, small, box, rc, TextFormatFlags.Right | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
        }

        for (int i = 0; i < 3; i++)
        {
            Rectangle r = buttons[i];
            bool on = hover == i && !busy;
            using (var path = Round(r, S(7)))
            using (var fill = new SolidBrush(raised))
            using (var pen = new Pen(on ? host.Accent : line, on ? 1.4f : 1f))
            {
                g.FillPath(fill, path);
                g.DrawPath(pen, path);
            }
            using (var num = new Font("Segoe UI", 7f))
            {
                TextRenderer.DrawText(g, (i + 1).ToString(), num, new Point(r.X + S(6), r.Y + S(3)), dim, TextFormatFlags.NoPadding);
            }
            Size ts = TextRenderer.MeasureText(g, Labels[i], Font, Size.Empty, TextFormatFlags.NoPadding);
            int iconW = S(18);
            int total = iconW + S(7) + ts.Width;
            int x0 = r.X + (r.Width - total) / 2;
            DrawWave(g, new Rectangle(x0, r.Y + r.Height / 2 - S(6), iconW, S(12)), on ? host.Accent : muted, 1.5f * s);
            TextRenderer.DrawText(g, Labels[i], Font, new Point(x0 + iconW + S(7), r.Y + (r.Height - ts.Height) / 2), on ? host.Accent : text, TextFormatFlags.NoPadding);
        }
    }

    // A damped wave: the elastic settle.
    static void DrawWave(Graphics g, Rectangle r, Color c, float width)
    {
        var pts = new PointF[33];
        for (int i = 0; i <= 32; i++)
        {
            float t = i / 32f;
            float y = (float)(Math.Sin(t * Math.PI * 3.2) * Math.Exp(-t * 2.6));
            pts[i] = new PointF(r.X + t * r.Width, r.Y + r.Height / 2f - y * r.Height / 2f);
        }
        using (var pen = new Pen(c, width) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
        {
            g.DrawLines(pen, pts);
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

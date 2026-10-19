// Mótion Film -- instalador/atualizador para Windows (extensão CEP do
// After Effects com todas as janelas + plugin do Figma).
//
// Compilado por installer/build.ps1 com o csc.exe do .NET Framework 4.x
// (já vem no Windows 10/11), com o pacote payload.zip embutido como
// recurso. O zip tem duas raízes:
//   motion-film/   -> %APPDATA%\Adobe\CEP\extensions\motion-film (por
//                     usuário, não precisa de administrador)
//   figma-plugin/  -> Documentos\Mótion Figma Layers\Plugin Figma
// E liga PlayerDebugMode=1 em HKCU\Software\Adobe\CSXS.9..16 (extensão
// não assinada).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Mótion Film - Instalador")]
[assembly: AssemblyProduct("Mótion Film")]
[assembly: AssemblyVersion("__VERSION__.0")]

namespace MotionFigmaLayers
{
    static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main()
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    static class Paths
    {
        public const string Version = "__VERSION__";
        public static string ExtensionDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Adobe\CEP\extensions\motion-film"); }
        }
        public static string SharedExtensionDir
        {
            get
            {
                string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
                if (string.IsNullOrEmpty(pf)) pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                return Path.Combine(pf, @"Common Files\Adobe\CEP\extensions\motion-film");
            }
        }
        public static string ToolsDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Mótion Figma Layers"); }
        }
        public static string PluginDir
        {
            get { return Path.Combine(ToolsDir, "Plugin Figma"); }
        }
        public static string PluginManifest
        {
            get { return Path.Combine(PluginDir, "manifest.json"); }
        }
        // User data lives OUTSIDE the extension folder and the installer
        // never touches it (update rule since 0.9.7): packs + settings.json
        // (colours, palettes, presets). Only shown in messages.
        public static string UserDataDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Mótion Film Packs"); }
        }

        // Where a hand-copied (manual / RAR) install may live. CEP reads
        // both; a second copy with the same extension id fights the one
        // this installer puts in AppData, so they get removed. A symlink
        // there is a developer setup and is left alone.
        public static string[] OldManualDirs()
        {
            var list = new System.Collections.Generic.List<string>();
            foreach (var root in new[] {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) })
            {
                if (string.IsNullOrEmpty(root)) continue;
                string dir = Path.Combine(root, @"Common Files\Adobe\CEP\extensions\motion-film");
                if (Directory.Exists(dir) && !IsLinkDir(dir) && !list.Contains(dir)) list.Add(dir);
            }
            return list.ToArray();
        }

        public static bool IsLinkDir(string dir)
        {
            try { return (new DirectoryInfo(dir).Attributes & FileAttributes.ReparsePoint) != 0; } catch { return false; }
        }

        static string ManifestVersion(string extDir)
        {
            try
            {
                string xml = File.ReadAllText(Path.Combine(extDir, @"CSXS\manifest.xml"));
                var m = System.Text.RegularExpressions.Regex.Match(xml, "ExtensionBundleVersion=\"([^\"]+)\"");
                return m.Success ? m.Groups[1].Value : null;
            }
            catch { return null; }
        }

        // Version installed now (by this installer, or a manual copy), or null.
        public static string InstalledVersion()
        {
            string v = ManifestVersion(ExtensionDir);
            if (v != null) return v;
            foreach (var dir in OldManualDirs())
            {
                v = ManifestVersion(dir);
                if (v != null) return v;
            }
            return null;
        }
    }

    // Same look as the CEP panel (client/styles.css defaults): #212121
    // background, raised rounded cards with a hairline border, "01 / ..."
    // kicker in the accent, version pill, dashed empty-state box and
    // 8px-radius buttons. Accent = the panel default #00f011.
    static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(33, 33, 33);        // --panel
        public static readonly Color Raised = Color.FromArgb(41, 41, 41);    // --panel-raised
        public static readonly Color Deep = Color.FromArgb(24, 24, 24);      // --panel-deep
        public static readonly Color Line = Color.FromArgb(56, 56, 56);      // --line over raised
        public static readonly Color LineStrong = Color.FromArgb(72, 72, 72);
        public static readonly Color Text = Color.FromArgb(242, 240, 245);
        public static readonly Color Muted = Color.FromArgb(145, 145, 159);
        public static readonly Color Dim = Color.FromArgb(96, 97, 108);
        public static readonly Color Accent = Color.FromArgb(0, 240, 17);
        public static readonly Color AccentHover = Color.FromArgb(70, 255, 85);
        public static readonly Color Ink = Color.FromArgb(17, 17, 17);
        public static readonly Color Danger = Color.FromArgb(211, 109, 132);
        public static readonly Color Warn = Color.FromArgb(232, 180, 76);

        static string family;
        public static Font UI(float size, FontStyle style)
        {
            if (family == null)
            {
                family = "Segoe UI";
                foreach (FontFamily f in FontFamily.Families)
                    if (f.Name == "Inter") { family = "Inter"; break; }
            }
            return new Font(family, size, style);
        }

        public static System.Drawing.Drawing2D.GraphicsPath Round(RectangleF r, float radius)
        {
            float d = radius * 2;
            var p = new System.Drawing.Drawing2D.GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        static float scale;
        public static float Scale
        {
            get
            {
                if (scale == 0)
                {
                    try { using (var g = Graphics.FromHwnd(IntPtr.Zero)) scale = g.DpiX / 96f; } catch { scale = 1; }
                }
                return scale;
            }
        }

        public static float Px(Control c, float v) { return v * Scale; }
    }

    // Rounded box: card (solid fill + hairline) or dashed well (status).
    class RoundBox : Panel
    {
        public Color Fill = Theme.Raised;
        public Color Border = Theme.Line;
        public bool Dashed;
        public float Radius = 12;

        public RoundBox()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent != null ? Parent.BackColor : Theme.Bg);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (var path = Theme.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), Theme.Px(this, Radius)))
            {
                if (!Dashed) using (var b = new SolidBrush(Fill)) g.FillPath(b, path);
                using (var pen = new Pen(Border))
                {
                    if (Dashed) pen.DashPattern = new float[] { 4, 3 };
                    g.DrawPath(pen, path);
                }
            }
            base.OnPaint(e);
        }
    }

    // Card with the panel's section header: "01 / TITLE" in the accent
    // over a hairline, body below (BodyTop).
    class Card : RoundBox
    {
        string kicker = "";
        public string Kicker { get { return kicker; } set { kicker = value; Invalidate(); } }
        public int BodyTop { get { return (int)Theme.Px(this, 44); } }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var g = e.Graphics;
            using (var f = Theme.UI(8f, FontStyle.Bold))
                TextRenderer.DrawText(g, Spaced(kicker), f, new Point((int)Theme.Px(this, 16), (int)Theme.Px(this, 14)), Theme.Accent, TextFormatFlags.NoPadding);
            int y = (int)Theme.Px(this, 42);
            using (var pen = new Pen(Theme.Line)) g.DrawLine(pen, 1, y, Width - 2, y);
        }

        // letter-spacing .16em, like .section-kicker
        static string Spaced(string s)
        {
            var sb = new System.Text.StringBuilder();
            foreach (char ch in s.ToUpperInvariant()) { if (sb.Length > 0) sb.Append(' '); sb.Append(ch); }
            return sb.ToString();
        }
    }

    // .primary-button / .footer-button: rounded, hairline, hover = accent
    // border. Primary = accent fill with dark ink.
    class FlatBtn : Control
    {
        public bool Primary;
        bool hover, down;

        public FlatBtn()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            Cursor = Cursors.Hand;
            TabStop = true;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
        protected override void OnKeyUp(KeyEventArgs e) { if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) OnClick(EventArgs.Empty); base.OnKeyUp(e); }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            Color bg = Parent != null ? Parent.BackColor : Theme.Bg;
            var box = Parent as RoundBox;
            if (box != null && !box.Dashed) bg = box.Fill;
            e.Graphics.Clear(bg);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            Color fill, border, fore;
            if (Primary)
            {
                fill = !Enabled ? Theme.Dim : (hover ? Theme.AccentHover : Theme.Accent);
                border = fill;
                fore = Theme.Ink;
            }
            else
            {
                fill = down ? Theme.Deep : Theme.Raised;
                border = Enabled && hover ? Theme.Accent : Theme.LineStrong;
                fore = !Enabled ? Theme.Dim : (hover ? Theme.Accent : Theme.Text);
            }
            using (var path = Theme.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), Theme.Px(this, 8)))
            {
                using (var b = new SolidBrush(fill)) g.FillPath(b, path);
                using (var pen = new Pen(border)) g.DrawPath(pen, path);
            }
            using (var f = Theme.UI(9f, FontStyle.Bold))
                TextRenderer.DrawText(g, Text, f, new Rectangle(0, down ? 1 : 0, Width, Height), fore,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }

    // Numbered step badge: a ring like the panel's anchor dots.
    class StepDot : Control
    {
        public StepDot()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            var box = Parent as RoundBox;
            g.Clear(box != null ? box.Fill : Theme.Raised);
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (var b = new SolidBrush(Theme.Deep)) g.FillEllipse(b, 0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var pen = new Pen(Theme.Accent, Theme.Px(this, 1.4f))) g.DrawEllipse(pen, 1f, 1f, Width - 2.5f, Height - 2.5f);
            using (var f = Theme.UI(8.5f, FontStyle.Bold))
                TextRenderer.DrawText(g, Text, f, new Rectangle(0, 0, Width, Height), Theme.Accent,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    class SetupForm : Form
    {
        Label status;
        FlatBtn installBtn, uninstallBtn, openPluginBtn, copyPathBtn, closeBtn;
        Card stepsPanel;
        RoundBox statusBox;

        static int S(float v) { return (int)Math.Round(v * Theme.Scale); }

        public SetupForm()
        {
            Text = "Mótion Film " + Paths.Version + " — Instalador";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = Theme.UI(9f, FontStyle.Regular);
            AutoScaleMode = AutoScaleMode.None;
            ClientSize = new Size(S(540), S(536));
            DoubleBuffered = true;

            // Top bar: brand as the active tab (accent text + underline),
            // version pill on the right, hairline under it all.
            Paint += delegate (object s, PaintEventArgs e)
            {
                var g = e.Graphics;
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (var pen = new Pen(Theme.Line)) g.DrawLine(pen, 0, S(52), ClientSize.Width, S(52));
                using (var f = Theme.UI(10.5f, FontStyle.Bold))
                {
                    Size sz = TextRenderer.MeasureText(g, "Mótion Film", f, Size.Empty, TextFormatFlags.NoPadding);
                    DrawLogo(g, new RectangleF(S(20), S(16), S(20), S(20)));
                    TextRenderer.DrawText(g, "Mótion Film", f, new Point(S(48), S(26) - sz.Height / 2), Theme.Accent, TextFormatFlags.NoPadding);
                    using (var b = new SolidBrush(Theme.Accent)) g.FillRectangle(b, S(16), S(50), S(48) - S(16) + sz.Width + S(6), S(2));
                }
                using (var f = Theme.UI(7.5f, FontStyle.Bold))
                {
                    string v = "v" + Paths.Version;
                    Size sz = TextRenderer.MeasureText(g, v, f, Size.Empty, TextFormatFlags.NoPadding);
                    var pill = new RectangleF(ClientSize.Width - S(20) - sz.Width - S(14), S(16), sz.Width + S(14), S(20));
                    using (var path = Theme.Round(pill, pill.Height / 2)) using (var b = new SolidBrush(Theme.Raised)) g.FillPath(b, path);
                    TextRenderer.DrawText(g, v, f, Rectangle.Round(pill), Theme.Dim, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                }
            };

            stepsPanel = new Card { Location = new Point(S(16), S(68)), Size = new Size(S(508), S(310)) };
            Controls.Add(stepsPanel);

            statusBox = new RoundBox { Dashed = true, Border = Theme.LineStrong, Radius = 8, Location = new Point(S(16), S(390)), Size = new Size(S(508), S(66)) };
            status = new Label
            {
                AutoSize = false, Location = new Point(S(12), S(6)), Size = new Size(S(484), S(54)),
                ForeColor = Theme.Muted, BackColor = Theme.Bg, TextAlign = ContentAlignment.MiddleCenter, Font = Theme.UI(8.5f, FontStyle.Regular)
            };
            statusBox.Controls.Add(status);
            Controls.Add(statusBox);

            installBtn = MakeButton("Instalar", true, new Point(S(16), S(474)), S(170));
            installBtn.Click += delegate { Install(); };
            uninstallBtn = MakeButton("Desinstalar", false, new Point(S(194), S(474)), S(130));
            uninstallBtn.Click += delegate { Uninstall(); };
            closeBtn = MakeButton("Fechar", false, new Point(S(394), S(474)), S(130));
            closeBtn.Click += delegate { Close(); };
            Controls.Add(installBtn);
            Controls.Add(uninstallBtn);
            Controls.Add(closeBtn);

            bool installed = Directory.Exists(Paths.ExtensionDir) || Paths.OldManualDirs().Length > 0;
            uninstallBtn.Visible = installed;
            if (installed)
            {
                string current = Paths.InstalledVersion();
                installBtn.Text = "Atualizar";
                status.Text = (current != null ? "Instalada: " + current + " → nova: " + Paths.Version + ". " : "Já instalado. ")
                    + "Packs, cores e presets (Documentos\\Mótion Film Packs) são mantidos.";
            }
            else
            {
                status.Text = "Feche o After Effects antes de instalar.";
            }
            ShowSteps(false);
#if PREVIEW
            // Layout check only (built by hand with /define:PREVIEW, never
            // by build.ps1): shows the "done" screen without installing.
            if (Environment.GetCommandLineArgs().Length > 1 && Environment.GetCommandLineArgs()[1] == "done")
            {
                ShowSteps(true);
                SetStatus("Atualizado 0.9.8 → " + Paths.Version + ". Packs, cores e presets foram mantidos; o plugin do Figma não precisa ser importado de novo.", Theme.Accent);
            }
#endif
        }

        // Three stacked chevrons, same drawing as build.ps1's icon.
        static void DrawLogo(Graphics g, RectangleF r)
        {
            using (var path = Theme.Round(r, r.Width * 0.22f)) using (var b = new SolidBrush(Theme.Accent)) g.FillPath(b, path);
            float k = r.Width / 256f;
            using (var pen = new Pen(Theme.Ink, Math.Max(1.5f, 18 * k)) { LineJoin = System.Drawing.Drawing2D.LineJoin.Round })
            {
                foreach (int dy in new[] { 0, 44, 88 })
                {
                    var pts = new[] {
                        new PointF(r.X + 128 * k, r.Y + (52 + dy) * k), new PointF(r.X + 206 * k, r.Y + (92 + dy) * k),
                        new PointF(r.X + 128 * k, r.Y + (132 + dy) * k), new PointF(r.X + 50 * k, r.Y + (92 + dy) * k) };
                    if (dy == 0) g.DrawPolygon(pen, pts); else g.DrawLines(pen, new[] { pts[3], pts[2], pts[1] });
                }
            }
        }

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        // Dark title bar (Windows 10 20H1+: immersive dark mode = 20) and,
        // on Windows 11, the caption painted in the panel colour (35).
        // Older systems just ignore it.
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                int on = 1;
                DwmSetWindowAttribute(Handle, 20, ref on, 4);
                int caption = Theme.Bg.R | (Theme.Bg.G << 8) | (Theme.Bg.B << 16);
                DwmSetWindowAttribute(Handle, 35, ref caption, 4);
            }
            catch { }
        }

        void SetStatus(string text, Color color)
        {
            status.ForeColor = color;
            status.Text = text;
        }

        FlatBtn MakeButton(string text, bool primary, Point loc, int width)
        {
            return new FlatBtn { Text = text, Primary = primary, Location = loc, Size = new Size(width, S(36)) };
        }

        void AddStep(int n, string head, string body, ref int y)
        {
            var badge = new StepDot { Text = n.ToString(), Size = new Size(S(24), S(24)), Location = new Point(S(16), y) };
            var h = new Label { Text = head, AutoSize = true, Location = new Point(S(52), y + S(2)), ForeColor = Theme.Text, BackColor = Theme.Raised, Font = Theme.UI(9.5f, FontStyle.Bold) };
            var b = new Label { Text = body, AutoSize = false, Size = new Size(S(440), S(34)), Location = new Point(S(52), y + S(22)), ForeColor = Theme.Muted, BackColor = Theme.Raised, Font = Theme.UI(8.5f, FontStyle.Regular) };
            stepsPanel.Controls.Add(badge);
            stepsPanel.Controls.Add(h);
            stepsPanel.Controls.Add(b);
            y += S(62);
        }

        void ShowSteps(bool done)
        {
            stepsPanel.Controls.Clear();
            int y = stepsPanel.BodyTop + S(14);
            if (!done)
            {
                stepsPanel.Kicker = "01 / " + (installBtn.Text == "Atualizar" ? "Atualizar" : "Instalar");
                var sub = new Label
                {
                    Text = "Instala ou atualiza a extensão do After Effects (Mótion Film, Paleta, Camadas e Mótion Figma Layers) e o plugin do Figma. Sem copiar pastas à mão.",
                    AutoSize = false, Size = new Size(S(476), S(38)), Location = new Point(S(16), y), ForeColor = Theme.Muted, BackColor = Theme.Raised, Font = Theme.UI(8.5f, FontStyle.Regular)
                };
                stepsPanel.Controls.Add(sub);
                y += S(50);
                AddStep(1, "Extensão do After Effects", "Instalada ou atualizada na sua pasta de usuário. Cópias antigas em Program Files são removidas.", ref y);
                AddStep(2, "Plugin do Figma", "Copiado para Documentos\\Mótion Figma Layers\\Plugin Figma.", ref y);
                AddStep(3, "Seus dados ficam", "Packs, cores e presets (Documentos\\Mótion Film Packs) não são tocados.", ref y);
                return;
            }
            stepsPanel.Kicker = "02 / Pronto";
            AddStep(1, "Abra o After Effects", "Window › Extensions › Mótion Film (e MF - Paleta, MF - Camadas, Mótion Figma Layers).", ref y);
            AddStep(2, "Figma: importe o plugin (só na 1ª instalação)", "Plugins › Development › Import plugin from manifest… e escolha o manifest.json (botões abaixo).", ref y);
            AddStep(3, "Atualizações futuras", "Rode o .exe novo e clique em Atualizar. Não precisa importar o plugin de novo.", ref y);

            openPluginBtn = MakeButton("Abrir pasta do plugin", true, new Point(S(52), y), S(190));
            openPluginBtn.Click += delegate
            {
                try { Process.Start("explorer.exe", "/select,\"" + Paths.PluginManifest + "\""); } catch { }
            };
            copyPathBtn = MakeButton("Copiar caminho do manifest", false, new Point(S(252), y), S(220));
            copyPathBtn.Click += delegate
            {
                try { Clipboard.SetText(Paths.PluginManifest); SetStatus("Caminho copiado: " + Paths.PluginManifest, Theme.Muted); } catch { }
            };
            stepsPanel.Controls.Add(openPluginBtn);
            stepsPanel.Controls.Add(copyPathBtn);
        }

        static bool AfterEffectsRunning()
        {
            try { return Process.GetProcessesByName("AfterFX").Length > 0; } catch { return false; }
        }

        static bool IsLink(string dir)
        {
            try { return (new DirectoryInfo(dir).Attributes & FileAttributes.ReparsePoint) != 0; } catch { return false; }
        }

        void Install()
        {
            if (AfterEffectsRunning())
            {
                var r = MessageBox.Show(this, "O After Effects está aberto. Feche ele antes de instalar/atualizar para a versão nova carregar.\r\n\r\nContinuar mesmo assim?", "Mótion Film", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (r != DialogResult.Yes) return;
            }

            bool devInstall = Directory.Exists(Paths.SharedExtensionDir) && IsLink(Paths.SharedExtensionDir);
            string previous = Paths.InstalledVersion();
            installBtn.Enabled = false;
            uninstallBtn.Enabled = false;
            Cursor = Cursors.WaitCursor;
            try
            {
                SetStatus("Instalando…", Theme.Muted);
                Refresh();

                using (Stream res = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                using (var zip = new ZipArchive(res, ZipArchiveMode.Read))
                {
                    // Extract next to the target first, then swap: a failed
                    // extraction (disk full, file locked) leaves the old
                    // version working instead of half a folder.
                    if (!devInstall) ReplaceDir(zip, "motion-film/", Paths.ExtensionDir);
                    ReplaceDir(zip, "figma-plugin/", Paths.PluginDir);
                }

                EnableUnsignedExtensions();

                string warn = "";
                if (devInstall)
                {
                    warn = "Este computador tem o Mótion Film em modo desenvolvimento (link em Program Files), então a extensão não foi duplicada. Só o plugin do Figma foi copiado.";
                }
                else
                {
                    warn = RemoveOldManualCopies();
                }

                ShowSteps(true);
                installBtn.Text = "Reinstalar";
                uninstallBtn.Visible = true;
                string done = previous != null
                    ? "Atualizado " + previous + " → " + Paths.Version + ". Packs, cores e presets foram mantidos; o plugin do Figma não precisa ser importado de novo."
                    : "Instalado! Siga os 3 passos acima.";
                if (string.IsNullOrEmpty(warn)) SetStatus(done, Theme.Accent); else SetStatus(warn, Theme.Warn);
            }
            catch (Exception ex)
            {
                SetStatus("Erro: " + ex.Message, Theme.Danger);
            }
            finally
            {
                installBtn.Enabled = true;
                uninstallBtn.Enabled = true;
                Cursor = Cursors.Default;
            }
        }

        // Removes hand-copied installs in Program Files. Those folders need
        // administrator rights: when a plain delete fails, Windows asks
        // (UAC) once and an elevated rmdir does it. Returns a warning, or "".
        static string RemoveOldManualCopies()
        {
            var left = new System.Collections.Generic.List<string>();
            foreach (var dir in Paths.OldManualDirs())
            {
                try { Directory.Delete(dir, true); } catch { left.Add(dir); }
            }
            if (left.Count == 0) return "";
            string cmd = "";
            foreach (var dir in left) cmd += (cmd.Length > 0 ? " & " : "") + "rmdir /s /q \"" + dir + "\"";
            try
            {
                var psi = new ProcessStartInfo("cmd.exe", "/c " + cmd) { Verb = "runas", UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden };
                using (var p = Process.Start(psi)) { p.WaitForExit(60000); }
            }
            catch { /* UAC recusado */ }
            var still = new System.Collections.Generic.List<string>();
            foreach (var dir in left) if (Directory.Exists(dir)) still.Add(dir);
            if (still.Count == 0) return "";
            return "Instalado, mas ficou uma cópia antiga (precisa de administrador para apagar):\r\n" + string.Join("\r\n", still.ToArray()) + "\r\nApague essa pasta para não ter duas versões.";
        }

        static void ReplaceDir(ZipArchive zip, string prefix, string target)
        {
            string staging = target + ".new";
            string old = target + ".old";
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            if (Directory.Exists(old)) Directory.Delete(old, true);
            Extract(zip, prefix, staging);
            if (Directory.Exists(target)) Directory.Move(target, old);
            try
            {
                Directory.Move(staging, target);
            }
            catch
            {
                if (Directory.Exists(old) && !Directory.Exists(target)) Directory.Move(old, target);
                throw;
            }
            try { if (Directory.Exists(old)) Directory.Delete(old, true); } catch { }
        }

        static void Extract(ZipArchive zip, string prefix, string target)
        {
            Directory.CreateDirectory(target);
            string root = Path.GetFullPath(target);
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                string name = entry.FullName.Replace('\\', '/');
                if (!name.StartsWith(prefix, StringComparison.Ordinal)) continue;
                string rel = name.Substring(prefix.Length);
                if (rel.Length == 0) continue;
                string dest = Path.GetFullPath(Path.Combine(target, rel.Replace('/', Path.DirectorySeparatorChar)));
                if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                if (name.EndsWith("/"))
                {
                    Directory.CreateDirectory(dest);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                using (Stream src = entry.Open())
                using (FileStream dst = File.Create(dest))
                {
                    src.CopyTo(dst);
                }
            }
        }

        static void EnableUnsignedExtensions()
        {
            for (int v = 9; v <= 16; v++)
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Adobe\CSXS." + v))
                {
                    if (key != null) key.SetValue("PlayerDebugMode", "1", RegistryValueKind.String);
                }
            }
        }

        void Uninstall()
        {
            var r = MessageBox.Show(this, "Remover a extensão Mótion Film (incluindo a janela Mótion Figma Layers) e o plugin do Figma deste usuário?\r\n\r\nSeus Packs, cores e presets em Documentos\\Mótion Film Packs NÃO são apagados.", "Desinstalar", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (r != DialogResult.Yes) return;
            try
            {
                if (Directory.Exists(Paths.ExtensionDir) && !IsLink(Paths.ExtensionDir)) Directory.Delete(Paths.ExtensionDir, true);
                if (Directory.Exists(Paths.PluginDir)) Directory.Delete(Paths.PluginDir, true);
                SetStatus("Removido. No Figma, apague o plugin em Plugins › Development › Manage plugins in development.", Theme.Muted);
                uninstallBtn.Visible = false;
                installBtn.Text = "Instalar";
                ShowSteps(false);
            }
            catch (Exception ex)
            {
                SetStatus("Erro ao remover: " + ex.Message + " (o After Effects está aberto?)", Theme.Danger);
            }
        }
    }
}

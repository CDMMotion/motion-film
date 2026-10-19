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

    class SetupForm : Form
    {
        static readonly Color CBg = Color.FromArgb(24, 24, 27);
        static readonly Color CPanel = Color.FromArgb(36, 36, 40);
        static readonly Color CLine = Color.FromArgb(58, 58, 64);
        static readonly Color CText = Color.FromArgb(242, 240, 245);
        static readonly Color CMuted = Color.FromArgb(160, 160, 172);
        static readonly Color CAccent = Color.FromArgb(159, 122, 234);

        Label status;
        Button installBtn, uninstallBtn, openPluginBtn, copyPathBtn, closeBtn;
        Panel stepsPanel;

        public SetupForm()
        {
            Text = "Mótion Film " + Paths.Version + " — Instalador";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = CBg;
            ForeColor = CText;
            Font = new Font("Segoe UI", 9.5f);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(560, 470);

            var title = new Label { Text = "Mótion Film " + Paths.Version, Font = new Font("Segoe UI Semibold", 17f), AutoSize = true, Location = new Point(28, 24), ForeColor = CText };
            var sub = new Label
            {
                Text = "Instala ou ATUALIZA a extensão Mótion Film do After Effects (Mótion Film, Paleta,\r\nCamadas e Mótion Figma Layers) e o plugin do Figma. Sem copiar pastas à mão.",
                AutoSize = false, Size = new Size(504, 44), Location = new Point(30, 66), ForeColor = CMuted
            };
            Controls.Add(title);
            Controls.Add(sub);

            stepsPanel = new Panel { Location = new Point(28, 122), Size = new Size(504, 236), BackColor = CPanel };
            stepsPanel.Paint += delegate (object s, PaintEventArgs e) { e.Graphics.DrawRectangle(new Pen(CLine), 0, 0, stepsPanel.Width - 1, stepsPanel.Height - 1); };
            Controls.Add(stepsPanel);
            ShowSteps(false);

            status = new Label { AutoSize = false, Size = new Size(504, 40), Location = new Point(28, 366), ForeColor = CMuted };
            Controls.Add(status);

            installBtn = MakeButton("Instalar", true, new Point(28, 412), 150);
            installBtn.Click += delegate { Install(); };
            uninstallBtn = MakeButton("Desinstalar", false, new Point(186, 412), 120);
            uninstallBtn.Click += delegate { Uninstall(); };
            closeBtn = MakeButton("Fechar", false, new Point(412, 412), 120);
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
        }

        Button MakeButton(string text, bool primary, Point loc, int width)
        {
            var b = new Button
            {
                Text = text, Location = loc, Size = new Size(width, 36), FlatStyle = FlatStyle.Flat,
                BackColor = primary ? CAccent : CPanel, ForeColor = primary ? Color.White : CText, Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderColor = primary ? CAccent : CLine;
            b.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(177, 145, 240) : Color.FromArgb(48, 48, 54);
            return b;
        }

        void AddStep(int n, string head, string body, ref int y)
        {
            var badge = new Label { Text = n.ToString(), Size = new Size(22, 22), Location = new Point(16, y), TextAlign = ContentAlignment.MiddleCenter, BackColor = CAccent, ForeColor = Color.White, Font = new Font("Segoe UI Semibold", 9f) };
            var h = new Label { Text = head, AutoSize = true, Location = new Point(48, y + 1), ForeColor = CText, Font = new Font("Segoe UI Semibold", 9.5f) };
            var b = new Label { Text = body, AutoSize = false, Size = new Size(440, 34), Location = new Point(48, y + 21), ForeColor = CMuted };
            stepsPanel.Controls.Add(badge);
            stepsPanel.Controls.Add(h);
            stepsPanel.Controls.Add(b);
            y += 58;
        }

        void ShowSteps(bool done)
        {
            stepsPanel.Controls.Clear();
            int y = 16;
            if (!done)
            {
                AddStep(1, "Extensão do After Effects", "Instalada ou atualizada na sua pasta de usuário. Cópias antigas em Program Files são removidas.", ref y);
                AddStep(2, "Plugin do Figma", "Copiado para Documentos\\Mótion Figma Layers\\Plugin Figma.", ref y);
                AddStep(3, "Seus dados ficam", "Packs, cores e presets (Documentos\\Mótion Film Packs) não são tocados.", ref y);
                return;
            }
            AddStep(1, "Abra o After Effects", "Window › Extensions › Mótion Film (e MF - Paleta, MF - Camadas, Mótion Figma Layers).", ref y);
            AddStep(2, "Figma: importe o plugin (só na 1ª instalação)", "Plugins › Development › Import plugin from manifest… e escolha o manifest.json (botões abaixo).", ref y);
            AddStep(3, "Atualizações futuras", "Rode o .exe novo e clique em Atualizar. Não precisa importar o plugin de novo.", ref y);

            openPluginBtn = MakeButton("Abrir pasta do plugin", true, new Point(48, y), 180);
            openPluginBtn.Click += delegate
            {
                try { Process.Start("explorer.exe", "/select,\"" + Paths.PluginManifest + "\""); } catch { }
            };
            copyPathBtn = MakeButton("Copiar caminho do manifest", false, new Point(236, y), 200);
            copyPathBtn.Click += delegate
            {
                try { Clipboard.SetText(Paths.PluginManifest); status.Text = "Caminho copiado: " + Paths.PluginManifest; } catch { }
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
                status.Text = "Instalando…";
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
                status.ForeColor = string.IsNullOrEmpty(warn) ? Color.FromArgb(61, 214, 140) : Color.FromArgb(232, 180, 76);
                string done = previous != null
                    ? "Atualizado " + previous + " → " + Paths.Version + ". Packs, cores e presets foram mantidos; o plugin do Figma não precisa ser importado de novo."
                    : "Instalado! Siga os 3 passos acima.";
                status.Text = string.IsNullOrEmpty(warn) ? done : warn;
            }
            catch (Exception ex)
            {
                status.ForeColor = Color.FromArgb(243, 163, 181);
                status.Text = "Erro: " + ex.Message;
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
                status.ForeColor = CMuted;
                status.Text = "Removido. No Figma, apague o plugin em Plugins › Development › Manage plugins in development.";
                uninstallBtn.Visible = false;
                installBtn.Text = "Instalar";
                ShowSteps(false);
            }
            catch (Exception ex)
            {
                status.ForeColor = Color.FromArgb(243, 163, 181);
                status.Text = "Erro ao remover: " + ex.Message + " (o After Effects está aberto?)";
            }
        }
    }
}

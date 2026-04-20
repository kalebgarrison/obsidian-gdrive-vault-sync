import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  normalizePath,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";

interface SyncPair {
  id: string;
  label: string;
  sourcePath: string;
  targetFolder: string;
  enabled: boolean;
}

interface GDriveSyncSettings {
  syncPairs: SyncPair[];
  syncInterval: number;
  autoSync: boolean;
}

const DEFAULT_SETTINGS: GDriveSyncSettings = {
  syncPairs: [
    {
      id: "pair-1",
      label: "Sync 1",
      sourcePath: "",
      targetFolder: "Google Drive",
      enabled: true,
    },
    {
      id: "pair-2",
      label: "Sync 2",
      sourcePath: "",
      targetFolder: "Google Drive 2",
      enabled: true,
    },
  ],
  syncInterval: 30,
  autoSync: false,
};

function generateId(): string {
  return "pair-" + Date.now().toString(36);
}

export default class GDriveSyncPlugin extends Plugin {
  settings: GDriveSyncSettings;
  syncIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();

    // Ribbon icon — sync all enabled pairs
    this.addRibbonIcon("refresh-cw", "Sync Google Drive Folders", () => {
      this.syncAll();
    });

    // Sync all command
    this.addCommand({
      id: "sync-all-gdrive-folders",
      name: "Sync All Google Drive Folders",
      callback: () => {
        this.syncAll();
      },
    });

    // Settings tab
    this.addSettingTab(new GDriveSyncSettingTab(this.app, this));

    // Auto-sync on load if enabled
    if (this.settings.autoSync) {
      this.startAutoSync();
    }
  }

  onunload() {
    this.stopAutoSync();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Ensure syncPairs always exists
    if (!this.settings.syncPairs) {
      this.settings.syncPairs = DEFAULT_SETTINGS.syncPairs;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  startAutoSync() {
    this.stopAutoSync();
    this.syncIntervalId = window.setInterval(
      () => {
        this.syncAll();
      },
      this.settings.syncInterval * 60 * 1000
    );
  }

  stopAutoSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  async syncAll() {
    const enabledPairs = this.settings.syncPairs.filter((p) => p.enabled);

    if (enabledPairs.length === 0) {
      new Notice("GDrive Sync: No sync sources enabled. Go to Settings to configure.");
      return;
    }

    let totalSynced = 0;
    const errors: string[] = [];

    for (const pair of enabledPairs) {
      if (!pair.sourcePath) {
        errors.push(`"${pair.label}": No source path set`);
        continue;
      }

      if (!fs.existsSync(pair.sourcePath)) {
        errors.push(`"${pair.label}": Source path not found`);
        continue;
      }

      try {
        const count = { value: 0 };
        await this.syncDirectory(pair.sourcePath, pair.targetFolder, count);
        totalSynced += count.value;
      } catch (error) {
        errors.push(`"${pair.label}": ${error.message}`);
        console.error(`GDrive Sync error for ${pair.label}:`, error);
      }
    }

    if (errors.length > 0) {
      new Notice(`GDrive Sync: ${errors.length} error(s):\n${errors.join("\n")}`);
    } else {
      new Notice(`GDrive Sync: Done — ${totalSynced} file(s) synced across ${enabledPairs.length} source(s) ✓`);
    }
  }

  async syncDirectory(
    sourceDir: string,
    targetDir: string,
    count: { value: number }
  ) {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    } catch (e) {
      console.error(`GDrive Sync: Cannot read directory ${sourceDir}:`, e);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "desktop.ini" || entry.name === ".DS_Store") continue;

      const entrySourcePath = path.join(sourceDir, entry.name);
      const entryTargetPath = normalizePath(`${targetDir}/${entry.name}`);

      if (entry.isDirectory()) {
        await this.syncDirectory(entrySourcePath, entryTargetPath, count);
      } else if (entry.isFile()) {
        const synced = await this.syncFile(entrySourcePath, entryTargetPath);
        if (synced) count.value++;
      }
    }
  }

  async syncFile(sourcePath: string, targetPath: string): Promise<boolean> {
    let sourceStats: fs.Stats;
    try {
      sourceStats = fs.statSync(sourcePath);
    } catch (e) {
      console.error(`GDrive Sync: Cannot stat file ${sourcePath}:`, e);
      return false;
    }

    const sourceModTime = sourceStats.mtimeMs;
    const existingFile = this.app.vault.getAbstractFileByPath(targetPath);

    if (existingFile instanceof TFile) {
      if (sourceModTime <= existingFile.stat.mtime) return false;

      try {
        if (this.isBinaryFile(targetPath)) {
          const buffer = fs.readFileSync(sourcePath);
          await this.app.vault.modifyBinary(existingFile, buffer.buffer);
        } else {
          const content = fs.readFileSync(sourcePath, "utf-8");
          await this.app.vault.modify(existingFile, content);
        }
        return true;
      } catch (e) {
        console.error(`GDrive Sync: Failed to update ${targetPath}:`, e);
        return false;
      }
    } else {
      try {
        await this.ensureFolder(
          targetPath.substring(0, targetPath.lastIndexOf("/"))
        );

        if (this.isBinaryFile(targetPath)) {
          const buffer = fs.readFileSync(sourcePath);
          await this.app.vault.createBinary(targetPath, buffer.buffer);
        } else {
          const content = fs.readFileSync(sourcePath, "utf-8");
          await this.app.vault.create(targetPath, content);
        }
        return true;
      } catch (e) {
        console.error(`GDrive Sync: Failed to create ${targetPath}:`, e);
        return false;
      }
    }
  }

  async ensureFolder(folderPath: string) {
    if (!folderPath) return;
    const parts = folderPath.split("/");
    let current = "";
    for (const part of parts) {
      if (!part) continue;
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try {
          await this.app.vault.createFolder(current);
        } catch (e) {
          // Already exists
        }
      }
    }
  }

  isBinaryFile(filePath: string): boolean {
    const binaryExtensions = [
      ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
      ".pdf", ".mp4", ".mp3", ".wav", ".ogg", ".m4a",
      ".zip", ".tar", ".gz", ".7z",
      ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ];
    return binaryExtensions.includes(path.extname(filePath).toLowerCase());
  }
}

class GDriveSyncSettingTab extends PluginSettingTab {
  plugin: GDriveSyncPlugin;

  constructor(app: App, plugin: GDriveSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "GDrive Vault Sync" });
    containerEl.createEl("p", {
      text: "Sync one or more Google Drive folders (mirrored via Google Drive for Desktop) into your vault.",
    });

    // ── Global Settings ──────────────────────────────────────
    containerEl.createEl("h3", { text: "Global Settings" });

    new Setting(containerEl)
      .setName("Auto Sync")
      .setDesc("Automatically sync all enabled sources on an interval.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveSettings();
            if (value) {
              this.plugin.startAutoSync();
              new Notice("GDrive Sync: Auto-sync enabled.");
            } else {
              this.plugin.stopAutoSync();
              new Notice("GDrive Sync: Auto-sync disabled.");
            }
          })
      );

    new Setting(containerEl)
      .setName("Sync Interval (minutes)")
      .setDesc("How often to auto-sync all sources. Minimum: 5 minutes.")
      .addText((text) =>
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.syncInterval))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 5) {
              this.plugin.settings.syncInterval = num;
              await this.plugin.saveSettings();
              if (this.plugin.settings.autoSync) {
                this.plugin.startAutoSync();
              }
            }
          })
      );

    new Setting(containerEl)
      .setName("Sync All Now")
      .setDesc("Manually trigger a sync across all enabled sources.")
      .addButton((btn) =>
        btn
          .setButtonText("Sync All Now")
          .setCta()
          .onClick(() => this.plugin.syncAll())
      );

    containerEl.createEl("hr");

    // ── Sync Sources ──────────────────────────────────────────
    containerEl.createEl("h3", { text: "Sync Sources" });

    this.plugin.settings.syncPairs.forEach((pair, index) => {
      this.renderPairSettings(containerEl, pair, index);
    });

    // Add new source button
    new Setting(containerEl)
      .addButton((btn) =>
        btn
          .setButtonText("+ Add Sync Source")
          .onClick(async () => {
            this.plugin.settings.syncPairs.push({
              id: generateId(),
              label: `Sync ${this.plugin.settings.syncPairs.length + 1}`,
              sourcePath: "",
              targetFolder: "Google Drive",
              enabled: true,
            });
            await this.plugin.saveSettings();
            this.display();
          })
      );
  }

  renderPairSettings(containerEl: HTMLElement, pair: SyncPair, index: number) {
    const pairContainer = containerEl.createDiv({ cls: "gdrive-sync-pair" });
    pairContainer.style.border = "1px solid var(--background-modifier-border)";
    pairContainer.style.borderRadius = "8px";
    pairContainer.style.padding = "12px";
    pairContainer.style.marginBottom = "16px";

    // Header row — label + enabled toggle + remove button
    new Setting(pairContainer)
      .setName(`Source ${index + 1}`)
      .addText((text) =>
        text
          .setPlaceholder("Label (e.g. Sermons, Meeting Notes)")
          .setValue(pair.label)
          .onChange(async (value) => {
            pair.label = value;
            await this.plugin.saveSettings();
          })
      )
      .addToggle((toggle) =>
        toggle
          .setValue(pair.enabled)
          .setTooltip("Enable/disable this sync source")
          .onChange(async (value) => {
            pair.enabled = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Remove")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.syncPairs.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // Source path
    new Setting(pairContainer)
      .setName("Google Drive Source Path")
      .setDesc("Full local path to the mirrored Google Drive folder.")
      .addText((text) =>
        text
          .setPlaceholder("/Users/yourname/Google Drive/My Drive/FolderName")
          .setValue(pair.sourcePath)
          .onChange(async (value) => {
            pair.sourcePath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // Target folder
    new Setting(pairContainer)
      .setName("Target Folder in Vault")
      .setDesc("Folder inside your vault where these files will appear.")
      .addText((text) =>
        text
          .setPlaceholder("Google Drive")
          .setValue(pair.targetFolder)
          .onChange(async (value) => {
            pair.targetFolder = value.trim() || "Google Drive";
            await this.plugin.saveSettings();
          })
      );

    // Sync this source only
    new Setting(pairContainer)
      .addButton((btn) =>
        btn
          .setButtonText("Sync This Source Now")
          .onClick(async () => {
            if (!pair.sourcePath) {
              new Notice(`GDrive Sync: No source path set for "${pair.label}".`);
              return;
            }
            if (!fs.existsSync(pair.sourcePath)) {
              new Notice(`GDrive Sync: Source path not found for "${pair.label}".`);
              return;
            }
            new Notice(`GDrive Sync: Syncing "${pair.label}"...`);
            const count = { value: 0 };
            await this.plugin.syncDirectory(pair.sourcePath, pair.targetFolder, count);
            new Notice(`GDrive Sync: "${pair.label}" done — ${count.value} file(s) synced ✓`);
          })
      );
  }
}

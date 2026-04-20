var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GDriveSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var DEFAULT_SETTINGS = {
  syncPairs: [
    {
      id: "pair-1",
      label: "Sync 1",
      sourcePath: "",
      targetFolder: "Google Drive",
      enabled: true
    },
    {
      id: "pair-2",
      label: "Sync 2",
      sourcePath: "",
      targetFolder: "Google Drive 2",
      enabled: true
    }
  ],
  syncInterval: 30,
  autoSync: false
};
function generateId() {
  return "pair-" + Date.now().toString(36);
}
var GDriveSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.syncIntervalId = null;
  }
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("refresh-cw", "Sync Google Drive Folders", () => {
      this.syncAll();
    });
    this.addCommand({
      id: "sync-all-gdrive-folders",
      name: "Sync All Google Drive Folders",
      callback: () => {
        this.syncAll();
      }
    });
    this.addSettingTab(new GDriveSyncSettingTab(this.app, this));
    if (this.settings.autoSync) {
      this.startAutoSync();
    }
  }
  onunload() {
    this.stopAutoSync();
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
      this.settings.syncInterval * 60 * 1e3
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
      new import_obsidian.Notice("GDrive Sync: No sync sources enabled. Go to Settings to configure.");
      return;
    }
    let totalSynced = 0;
    const errors = [];
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
      new import_obsidian.Notice(`GDrive Sync: ${errors.length} error(s):
${errors.join("\n")}`);
    } else {
      new import_obsidian.Notice(`GDrive Sync: Done \u2014 ${totalSynced} file(s) synced across ${enabledPairs.length} source(s) \u2713`);
    }
  }
  async syncDirectory(sourceDir, targetDir, count) {
    let entries;
    try {
      entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    } catch (e) {
      console.error(`GDrive Sync: Cannot read directory ${sourceDir}:`, e);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith("."))
        continue;
      if (entry.name === "desktop.ini" || entry.name === ".DS_Store")
        continue;
      const entrySourcePath = path.join(sourceDir, entry.name);
      const entryTargetPath = (0, import_obsidian.normalizePath)(`${targetDir}/${entry.name}`);
      if (entry.isDirectory()) {
        await this.syncDirectory(entrySourcePath, entryTargetPath, count);
      } else if (entry.isFile()) {
        const synced = await this.syncFile(entrySourcePath, entryTargetPath);
        if (synced)
          count.value++;
      }
    }
  }
  async syncFile(sourcePath, targetPath) {
    let sourceStats;
    try {
      sourceStats = fs.statSync(sourcePath);
    } catch (e) {
      console.error(`GDrive Sync: Cannot stat file ${sourcePath}:`, e);
      return false;
    }
    const sourceModTime = sourceStats.mtimeMs;
    const existingFile = this.app.vault.getAbstractFileByPath(targetPath);
    if (existingFile instanceof import_obsidian.TFile) {
      if (sourceModTime <= existingFile.stat.mtime)
        return false;
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
  async ensureFolder(folderPath) {
    if (!folderPath)
      return;
    const parts = folderPath.split("/");
    let current = "";
    for (const part of parts) {
      if (!part)
        continue;
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try {
          await this.app.vault.createFolder(current);
        } catch (e) {
        }
      }
    }
  }
  isBinaryFile(filePath) {
    const binaryExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".bmp",
      ".ico",
      ".pdf",
      ".mp4",
      ".mp3",
      ".wav",
      ".ogg",
      ".m4a",
      ".zip",
      ".tar",
      ".gz",
      ".7z",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx"
    ];
    return binaryExtensions.includes(path.extname(filePath).toLowerCase());
  }
};
var GDriveSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "GDrive Vault Sync" });
    containerEl.createEl("p", {
      text: "Sync one or more Google Drive folders (mirrored via Google Drive for Desktop) into your vault."
    });
    containerEl.createEl("h3", { text: "Global Settings" });
    new import_obsidian.Setting(containerEl).setName("Auto Sync").setDesc("Automatically sync all enabled sources on an interval.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
        this.plugin.settings.autoSync = value;
        await this.plugin.saveSettings();
        if (value) {
          this.plugin.startAutoSync();
          new import_obsidian.Notice("GDrive Sync: Auto-sync enabled.");
        } else {
          this.plugin.stopAutoSync();
          new import_obsidian.Notice("GDrive Sync: Auto-sync disabled.");
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Sync Interval (minutes)").setDesc("How often to auto-sync all sources. Minimum: 5 minutes.").addText(
      (text) => text.setPlaceholder("30").setValue(String(this.plugin.settings.syncInterval)).onChange(async (value) => {
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
    new import_obsidian.Setting(containerEl).setName("Sync All Now").setDesc("Manually trigger a sync across all enabled sources.").addButton(
      (btn) => btn.setButtonText("Sync All Now").setCta().onClick(() => this.plugin.syncAll())
    );
    containerEl.createEl("hr");
    containerEl.createEl("h3", { text: "Sync Sources" });
    this.plugin.settings.syncPairs.forEach((pair, index) => {
      this.renderPairSettings(containerEl, pair, index);
    });
    new import_obsidian.Setting(containerEl).addButton(
      (btn) => btn.setButtonText("+ Add Sync Source").onClick(async () => {
        this.plugin.settings.syncPairs.push({
          id: generateId(),
          label: `Sync ${this.plugin.settings.syncPairs.length + 1}`,
          sourcePath: "",
          targetFolder: "Google Drive",
          enabled: true
        });
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
  renderPairSettings(containerEl, pair, index) {
    const pairContainer = containerEl.createDiv({ cls: "gdrive-sync-pair" });
    pairContainer.style.border = "1px solid var(--background-modifier-border)";
    pairContainer.style.borderRadius = "8px";
    pairContainer.style.padding = "12px";
    pairContainer.style.marginBottom = "16px";
    new import_obsidian.Setting(pairContainer).setName(`Source ${index + 1}`).addText(
      (text) => text.setPlaceholder("Label (e.g. Sermons, Meeting Notes)").setValue(pair.label).onChange(async (value) => {
        pair.label = value;
        await this.plugin.saveSettings();
      })
    ).addToggle(
      (toggle) => toggle.setValue(pair.enabled).setTooltip("Enable/disable this sync source").onChange(async (value) => {
        pair.enabled = value;
        await this.plugin.saveSettings();
      })
    ).addButton(
      (btn) => btn.setButtonText("Remove").setWarning().onClick(async () => {
        this.plugin.settings.syncPairs.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      })
    );
    new import_obsidian.Setting(pairContainer).setName("Google Drive Source Path").setDesc("Full local path to the mirrored Google Drive folder.").addText(
      (text) => text.setPlaceholder("/Users/yourname/Google Drive/My Drive/FolderName").setValue(pair.sourcePath).onChange(async (value) => {
        pair.sourcePath = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(pairContainer).setName("Target Folder in Vault").setDesc("Folder inside your vault where these files will appear.").addText(
      (text) => text.setPlaceholder("Google Drive").setValue(pair.targetFolder).onChange(async (value) => {
        pair.targetFolder = value.trim() || "Google Drive";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(pairContainer).addButton(
      (btn) => btn.setButtonText("Sync This Source Now").onClick(async () => {
        if (!pair.sourcePath) {
          new import_obsidian.Notice(`GDrive Sync: No source path set for "${pair.label}".`);
          return;
        }
        if (!fs.existsSync(pair.sourcePath)) {
          new import_obsidian.Notice(`GDrive Sync: Source path not found for "${pair.label}".`);
          return;
        }
        new import_obsidian.Notice(`GDrive Sync: Syncing "${pair.label}"...`);
        const count = { value: 0 };
        await this.plugin.syncDirectory(pair.sourcePath, pair.targetFolder, count);
        new import_obsidian.Notice(`GDrive Sync: "${pair.label}" done \u2014 ${count.value} file(s) synced \u2713`);
      })
    );
  }
};

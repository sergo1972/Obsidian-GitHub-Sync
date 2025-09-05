import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Vault } from 'obsidian';
import { simpleGit, SimpleGit, CleanOptions, SimpleGitOptions } from 'simple-git';
import { setIntervalAsync, clearIntervalAsync } from 'set-interval-async';
// @ts-ignore
import gitMobile from 'isomorphic-git';
// @ts-ignore
import LightningFS from '@isomorphic-git/lightning-fs';
// @ts-ignore
import http from 'isomorphic-git/http/web';

let simpleGitOptions: Partial<SimpleGitOptions>;
let git: SimpleGit;

interface GHSyncSettings {
	remoteURL: string;
	gitLocation: string; // Для мобильных устройств будет GitHub PAT
	syncinterval: number;
	isSyncOnLoad: boolean;
	checkStatusOnLoad: boolean;
}

const DEFAULT_SETTINGS: GHSyncSettings = {
	remoteURL: '',
	gitLocation: '',
	syncinterval: 0,
	isSyncOnLoad: false,
	checkStatusOnLoad: true,
}

export default class GHSyncPlugin extends Plugin {

	settings: GHSyncSettings;

	isMobile(): boolean {
		return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
	}

	async mobileSync() {
		new Notice("Mobile Sync: syncing with GitHub...");

		const vaultPath = '/vault';
		const fs = new LightningFS('vault');
		const dir = vaultPath;
		const repoUrl = this.settings.remoteURL.trim();
		const token = this.settings.gitLocation.trim();

		if (!repoUrl || !token) {
			new Notice("Mobile Sync: Please configure Remote URL and GitHub Token in settings", 10000);
			return;
		}

		try {
			// Check if repository is initialized
			let isRepo = false;
			try {
				await gitMobile.findRoot({ fs, filepath: dir });
				isRepo = true;
			} catch (e) {
				// Repository not found, need to initialize
			}

			if (!isRepo) {
				// Initialize repository
				await gitMobile.init({ fs, dir });
				
				// Add remote origin
				await gitMobile.addRemote({ fs, dir, remote: 'origin', url: repoUrl });
				
				// Clone the repository if it exists
				try {
					await gitMobile.clone({
						fs,
						http,
						dir,
						url: repoUrl,
						singleBranch: true,
						onAuth: () => ({ username: token, password: '' })
					});
					new Notice("Mobile Sync: Repository cloned successfully");
				} catch (cloneError) {
					// If clone fails, create initial commit
					await gitMobile.add({ fs, dir, filepath: '.' });
					await gitMobile.commit({ 
						fs, 
						dir, 
						message: 'Initial commit from mobile', 
						author: { name: 'ObsidianUser', email: 'user@example.com' } 
					});
					new Notice("Mobile Sync: Initial commit created");
				}
			} else {
				// Pull latest changes
				try {
					await gitMobile.pull({
						fs,
						http,
						dir,
						url: repoUrl,
						singleBranch: true,
						author: { name: 'ObsidianUser', email: 'user@example.com' },
						onAuth: () => ({ username: token, password: '' })
					});
					new Notice("Mobile Sync: Pulled latest changes");
				} catch (pullError) {
					new Notice("Mobile Sync: Pull failed, continuing with push", 5000);
				}
			}

			// Add all files
			await gitMobile.add({ fs, dir, filepath: '.' });

			// Check if there are changes to commit
			const status = await gitMobile.status({ fs, dir, filepath: '.' });
			if (status.length === 0) {
				new Notice("Mobile Sync: No changes to commit");
				return;
			}

			// Commit
			const date = new Date();
			const msg = `Mobile sync ${date.toISOString()}`;
			await gitMobile.commit({ 
				fs, 
				dir, 
				message: msg, 
				author: { name: 'ObsidianUser', email: 'user@example.com' } 
			});

			// Push
			await gitMobile.push({
				fs,
				http,
				dir,
				url: repoUrl,
				onAuth: () => ({ username: token, password: '' })
			});

			new Notice("Mobile Sync complete ✅");
		} catch (e) {
			console.error("Mobile Sync Error:", e);
			new Notice("Mobile Sync failed ❌: " + (e.message || e), 10000);
		}
	}

	async mobileCheckStatus() {
		if (!this.settings.checkStatusOnLoad) return;

		const vaultPath = '/vault';
		const fs = new LightningFS('vault');
		const dir = vaultPath;
		const repoUrl = this.settings.remoteURL.trim();
		const token = this.settings.gitLocation.trim();

		if (!repoUrl || !token) {
			return;
		}

		try {
			// Check if repository exists
			await gitMobile.findRoot({ fs, filepath: dir });
			
			// Fetch latest changes
			await gitMobile.fetch({
				fs,
				http,
				dir,
				url: repoUrl,
				onAuth: () => ({ username: token, password: '' })
			});

			// Check status
			const status = await gitMobile.status({ fs, dir, filepath: '.' });
			const log = await gitMobile.log({ fs, dir, depth: 1 });
			const remoteLog = await gitMobile.log({ fs, dir, ref: 'origin/main', depth: 1 });

			if (log.length > 0 && remoteLog.length > 0) {
				const localCommit = log[0].oid;
				const remoteCommit = remoteLog[0].oid;
				
				if (localCommit !== remoteCommit) {
					if (this.settings.isSyncOnLoad) {
						this.mobileSync();
					} else {
						new Notice("Mobile Sync: Repository is behind remote. Click sync to update.");
					}
				} else {
					new Notice("Mobile Sync: Repository is up to date.");
				}
			}
		} catch (e) {
			// Repository not initialized or other error - ignore
		}
	}

	async SyncNotes() {
		if (this.isMobile()) {
			await this.mobileSync();
			return;
		}

		new Notice("Syncing to GitHub remote");

		const remote = this.settings.remoteURL.trim();

		simpleGitOptions = {
			//@ts-ignore
		    baseDir: this.app.vault.adapter.getBasePath(),
		    binary: this.settings.gitLocation + "git",
		    maxConcurrentProcesses: 6,
		    trimmed: false,
		};
		git = simpleGit(simpleGitOptions);

		let os = require("os");
		let hostname = os.hostname();

		let statusResult = await git.status().catch((e) => {
			new Notice("Vault is not a Git repo or git binary cannot be found.", 10000);
			return;
		});

		//@ts-ignore
		let clean = statusResult.isClean();

    	let date = new Date();
    	let msg = hostname + " " + date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + ":" + date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();

		if (!clean) {
			try {
				await git
		    		.add("./*")
		    		.commit(msg);
		    } catch (e) {
		    	new Notice(e);
		    	return;
		    }
		} else {
			new Notice("Working branch clean");
		}

		// configure remote
		try {
			await git.removeRemote('origin').catch((e) => { new Notice(e); });
			await git.addRemote('origin', remote).catch((e) => { new Notice(e); });
		}
		catch (e) {
			new Notice(e);
			return;
		}
		// check if remote url valid by fetching
		try {
			await git.fetch();
		} catch (e) {
			new Notice(e + "\nGitHub Sync: Invalid remote URL.", 10000);
			return;
		}

		new Notice("GitHub Sync: Successfully set remote origin url");

	    try {
	    	//@ts-ignore
	    	await git.pull('origin', 'main', { '--no-rebase': null }, (err, update) => {
	      		if (update) {
					new Notice("GitHub Sync: Pulled " + update.summary.changes + " changes");
	      		}
	   		})
	    } catch (e) {
	    	let conflictStatus = await git.status().catch((e) => { new Notice(e, 10000); return; });
    		let conflictMsg = "Merge conflicts in:";
	    	//@ts-ignore
			for (let c of conflictStatus.conflicted)
			{
				conflictMsg += "\n\t"+c;
			}
			conflictMsg += "\nResolve them or click sync button again to push with unresolved conflicts."
			new Notice(conflictMsg)
			//@ts-ignore	
			for (let c of conflictStatus.conflicted)
			{
				this.app.workspace.openLinkText("", c, true);
			}
	    	return;
	    }

	    if (!clean) {
		    try {
		    	git.push('origin', 'main', ['-u']);
		    	new Notice("GitHub Sync: Pushed on " + msg);
		    } catch (e) {
		    	new Notice(e, 10000);
			}
	    }
	}

	async CheckStatusOnStart() {
		if (this.isMobile()) {
			await this.mobileCheckStatus();
			return;
		}

		try {
			simpleGitOptions = {
				//@ts-ignore
			    baseDir: this.app.vault.adapter.getBasePath(),
			    binary: this.settings.gitLocation + "git",
			    maxConcurrentProcesses: 6,
			    trimmed: false,
			};
			git = simpleGit(simpleGitOptions);

			await git.branch({'--set-upstream-to': 'origin/main'});
			let statusUponOpening = await git.fetch().status();
			if (statusUponOpening.behind > 0)
			{
				if (this.settings.isSyncOnLoad == true)
				{
					this.SyncNotes();
				}
				else
				{
					new Notice("GitHub Sync: " + statusUponOpening.behind + " commits behind remote.\nClick the GitHub ribbon icon to sync.")
				}
			}
			else
			{
				new Notice("GitHub Sync: up to date with remote.")
			}
		} catch (e) {
			// ignore
		}
	}

	async onload() {
		await this.loadSettings();

		const ribbonIconEl = this.addRibbonIcon('github', 'Sync with Remote', (evt: MouseEvent) => {
			this.SyncNotes();
		});
		ribbonIconEl.addClass('gh-sync-ribbon');

		this.addCommand({
			id: 'github-sync-command',
			name: 'Sync with Remote',
			callback: () => {
				this.SyncNotes();
			}
		});

		this.addSettingTab(new GHSyncSettingTab(this.app, this));

		if (!isNaN(this.settings.syncinterval))
		{
			let interval: number = this.settings.syncinterval;
			if (interval >= 1)
			{
				try {
					setIntervalAsync(async () => {
						await this.SyncNotes();
					}, interval * 60 * 1000);
					new Notice("Auto sync enabled");
				} catch (e) { }
			}
		}

		if (this.settings.checkStatusOnLoad)
		{
			this.CheckStatusOnStart();
		}
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class GHSyncSettingTab extends PluginSettingTab {
	plugin: GHSyncPlugin;

	constructor(app: App, plugin: GHSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		const howto = containerEl.createEl("div", { cls: "howto" });
		howto.createEl("div", { text: "How to use this plugin", cls: "howto_title" });
		howto.createEl("small", { text: "Grab your GitHub repository's HTTPS or SSH url and paste it into the settings here. If you're on mobile, also paste your GitHub Personal Access Token in the token field. For mobile sync, you need a token with 'repo' permissions.", cls: "howto_text" });
		howto.createEl("br");
        const linkEl = howto.createEl('p');
        linkEl.createEl('span', { text: 'See the ' });
        linkEl.createEl('a', { href: 'https://github.com/kevinmkchin/Obsidian-GitHub-Sync/blob/main/README.md', text: 'README' });
        linkEl.createEl('span', { text: ' for more information and troubleshooting.' });

		new Setting(containerEl)
			.setName('Remote URL')
			.setDesc('')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.remoteURL)
				.onChange(async (value) => {
					this.plugin.settings.remoteURL = value;
					await this.plugin.saveSettings();
				})
        	.inputEl.addClass('my-plugin-setting-text'));

		new Setting(containerEl)
			.setName('GitHub Personal Access Token (mobile)')
			.setDesc('Enter your GitHub Personal Access Token for mobile sync. On desktop this field is ignored. Create a token at: https://github.com/settings/tokens')
			.addText(text => text
				.setPlaceholder('ghp_xxxxxxxxxxxxxxxxxxxx')
				.setValue(this.plugin.settings.gitLocation)
				.onChange(async (value) => {
					this.plugin.settings.gitLocation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Check status on startup')
			.setDesc('Check to see if you are behind remote when you start Obsidian.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.checkStatusOnLoad)
				.onChange(async (value) => {
					this.plugin.settings.checkStatusOnLoad = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto sync on startup')
			.setDesc('Automatically sync with remote when you start Obsidian if there are unsynced changes.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.isSyncOnLoad)
				.onChange(async (value) => {
					this.plugin.settings.isSyncOnLoad = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto sync at interval')
			.setDesc('Set minute interval after which your vault is synced automatically. Auto sync is disabled if this field is left empty or not a positive integer. Restart Obsidian to take effect.')
			.addText(text => text
				.setValue(String(this.plugin.settings.syncinterval))
				.onChange(async (value) => {
					this.plugin.settings.syncinterval = Number(value);
					await this.plugin.saveSettings();
				}));
	}
}

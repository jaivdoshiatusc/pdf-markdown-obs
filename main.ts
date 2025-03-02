import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf
} from 'obsidian';
import {
	PDFDocument,
	PDFName,
	PDFDict,
	PDFArray,
	PDFHexString,
	PDFString,
	PDFStream,
	decodePDFRawStream,
} from 'pdf-lib';

interface PdfMarkdownPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: PdfMarkdownPluginSettings = {
	mySetting: 'default'
};

export default class PdfMarkdownPlugin extends Plugin {
	settings: PdfMarkdownPluginSettings;
	// Store a reference to the markdown leaf (if open)
	private mdLeaf: WorkspaceLeaf | null = null;

	async onload() {
		await this.loadSettings();

		// Ribbon icon toggles the markdown side-by-side view.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Toggle PDF Markdown View', async (evt: MouseEvent) => {
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile || activeFile.extension !== 'pdf') {
				new Notice("Please open a PDF file.");
				return;
			}

			// Toggle: if the markdown leaf is open, close it.
			if (this.mdLeaf) {
				this.mdLeaf.detach();
				this.mdLeaf = null;
				return;
			}

			try {
				const pdfData = await this.app.vault.readBinary(activeFile);
				const pdfBytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
				const mdFilePath = activeFile.path.replace(/\.pdf$/i, '-notes.md');
			
				// Check if the markdown file already exists.
				let markdown = "";
				let mdFile = this.app.vault.getAbstractFileByPath(mdFilePath);
				if (mdFile && mdFile instanceof TFile) {
					// If it exists, read its current content.
					markdown = await this.app.vault.read(mdFile);
				} else {
					// Otherwise, extract embedded markdown from the PDF.
					markdown = (await extractMarkdownFromPdf(pdfBytes)) || "";
					// And create the file.
					await this.app.vault.create(mdFilePath, markdown);
				}
			
				// Now update the PDF: remove any old "notes.md" attachment and re-attach the current markdown.
				const newPdfBytes = await embedMarkdownInPdf(pdfBytes, markdown);
				await this.app.vault.modifyBinary(activeFile, newPdfBytes);
			
				// Open the markdown file in a new split view.
				this.mdLeaf = this.app.workspace.getLeaf('split');
				await this.app.workspace.openLinkText(mdFilePath, '', true);
			} catch (error) {
				new Notice("Error toggling Markdown view: " + error);
				console.error(error);
			}			
		});
		ribbonIconEl.addClass('pdf-markdown-plugin-ribbon');

		// Add a status bar item.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('PDF Markdown Plugin Active');

		// Command to extract embedded Markdown from PDF (separate command)
		this.addCommand({
			id: 'extract-markdown',
			name: 'Extract Markdown from PDF (as file)',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || activeFile.extension !== 'pdf') return false;
				if (checking) return true;
				(async () => {
					try {
						const pdfData = await this.app.vault.readBinary(activeFile);
						const pdfBytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
						const markdown = await extractMarkdownFromPdf(pdfBytes);
						if (markdown) {
							const newFile = await this.app.vault.create(activeFile.basename + '-Extracted.md', markdown);
							await this.app.workspace.openLinkText(newFile.path, '', false);
							new Notice("Markdown extracted successfully!");
						} else {
							new Notice("No embedded Markdown found.");
						}
					} catch (error) {
						new Notice("Error extracting Markdown: " + error);
						console.error(error);
					}
				})();
				return true;
			}
		});

		// Add the settings tab.
		this.addSettingTab(new PdfMarkdownSettingTab(this.app, this));

		// Inside your onload() method
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				// Check if the modified file is the markdown file associated with the active PDF.
				const activePDF = this.app.workspace.getActiveFile();
				if (!activePDF || activePDF.extension !== 'pdf') return;

				const mdFilePath = activePDF.path.replace(/\.pdf$/i, '-notes.md');
				if (file.path === mdFilePath) {
					// Get the updated markdown content.
					const markdown = await this.app.vault.read(file as TFile);
					// Read the current PDF binary data.
					const pdfData = await this.app.vault.readBinary(activePDF);
					const pdfBytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);
					// Re-embed the updated markdown into the PDF.
					const newPdfBytes = await embedMarkdownInPdf(pdfBytes, markdown);
					// Overwrite the original PDF.
					await this.app.vault.modifyBinary(activePDF, newPdfBytes);
					new Notice("PDF updated with latest Markdown changes.");
				}
			})
		);
	}

	onunload() {
		if (this.mdLeaf) {
			this.mdLeaf.detach();
			this.mdLeaf = null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * Removes any existing attachment named "notes.md" from the PDF's EmbeddedFiles dictionary.
 */
async function removeExistingNotesAttachment(pdfDoc: PDFDocument): Promise<void> {
	const catalog = pdfDoc.catalog;
	if (!catalog.has(PDFName.of('Names'))) return;
	const namesDict = catalog.lookup(PDFName.of('Names'), PDFDict);
	if (!namesDict.has(PDFName.of('EmbeddedFiles'))) return;
	const embeddedFilesDict = namesDict.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
	if (!embeddedFilesDict.has(PDFName.of('Names'))) return;
	const namesArray = embeddedFilesDict.lookup(PDFName.of('Names'), PDFArray);
	// Convert array to a JavaScript array.
	const arr = namesArray.asArray();
	const newArr = [];
	// Iterate in pairs.
	for (let i = 0; i < arr.length; i += 2) {
		const nameObj = arr[i] as PDFHexString | PDFString;
		const nameText = nameObj.decodeText();
		if (nameText === 'notes.md') continue; // Skip this attachment.
		newArr.push(arr[i], arr[i + 1]);
	}
	// Replace the Names array with our filtered array.
	const newNamesArray = pdfDoc.context.obj(newArr);
	embeddedFilesDict.set(PDFName.of('Names'), newNamesArray);
}

/**
 * Embeds the provided Markdown content into the PDF as an attachment,
 * after removing any existing "notes.md" attachment.
 *
 * @param pdfBytes - The original PDF as a Uint8Array.
 * @param markdownContent - The Markdown string to embed.
 * @returns The modified PDF as a Uint8Array.
 */
async function embedMarkdownInPdf(pdfBytes: Uint8Array, markdownContent: string): Promise<Uint8Array> {
	const pdfDoc = await PDFDocument.load(pdfBytes);
	// Remove any existing "notes.md" attachment.
	await removeExistingNotesAttachment(pdfDoc);
	const markdownBytes = new TextEncoder().encode(markdownContent);
	await pdfDoc.attach(markdownBytes, 'notes.md', {
		mimeType: 'text/markdown',
		description: 'Embedded Markdown notes for Obsidian',
		creationDate: new Date(),
		modificationDate: new Date(),
	});
	return await pdfDoc.save();
}

/**
 * Low-level function to extract attachments from the PDF.
 * Returns an array of objects with the attachment name and raw data.
 */
async function extractAttachmentsFromPdf(pdfBytes: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
	const pdfDoc = await PDFDocument.load(pdfBytes);
	const catalog = pdfDoc.catalog;
	if (!catalog.has(PDFName.of('Names'))) return [];
	const namesDict = catalog.lookup(PDFName.of('Names'), PDFDict);
	if (!namesDict.has(PDFName.of('EmbeddedFiles'))) return [];
	let embeddedFilesDict = namesDict.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
	if (!embeddedFilesDict.has(PDFName.of('Names')) && embeddedFilesDict.has(PDFName.of('Kids'))) {
		const kids = embeddedFilesDict.lookup(PDFName.of('Kids'), PDFArray);
		if (kids.size() > 0) {
			embeddedFilesDict = kids.lookup(0, PDFDict);
		}
	}
	if (!embeddedFilesDict.has(PDFName.of('Names'))) return [];
	const efNames = embeddedFilesDict.lookup(PDFName.of('Names'), PDFArray);
	const attachments: { name: string; data: Uint8Array }[] = [];
	for (let idx = 0, len = efNames.size(); idx < len; idx += 2) {
		const fileNameObj = efNames.lookup(idx) as PDFHexString | PDFString;
		const fileSpec = efNames.lookup(idx + 1, PDFDict);
		const efDict = fileSpec.lookup(PDFName.of('EF'), PDFDict);
		const fileStream = efDict.lookup(PDFName.of('F'), PDFStream) as PDFStream;
		// Cast fileStream to any so decodePDFRawStream accepts it.
		const decoded = decodePDFRawStream(fileStream as any);
		const fileData = decoded.decode();
		const attachmentName = fileNameObj.decodeText();
		attachments.push({ name: attachmentName, data: fileData });
	}
	return attachments;
}

/**
 * Extracts embedded Markdown (specifically the attachment named "notes.md") from the PDF.
 * Returns the Markdown content as a string if found; otherwise, null.
 */
async function extractMarkdownFromPdf(pdfBytes: Uint8Array): Promise<string | null> {
	const attachments = await extractAttachmentsFromPdf(pdfBytes);
	const mdAttachment = attachments.find(att => att.name === 'notes.md');
	if (mdAttachment) {
		return new TextDecoder().decode(mdAttachment.data);
	}
	return null;
}

/**
 * Settings tab for the PDF Markdown Plugin.
 */
class PdfMarkdownSettingTab extends PluginSettingTab {
	plugin: PdfMarkdownPlugin;
	constructor(app: App, plugin: PdfMarkdownPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'PDF Markdown Plugin Settings' });
		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret setting')
			.addText((text) =>
				text
					.setPlaceholder('Enter your secret')
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					})
			);
	}
}



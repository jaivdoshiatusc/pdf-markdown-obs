# PDF Markdown Plugin for Obsidian

This Obsidian plugin makes PDF note-taking a breeze by letting you embed and extract Markdown notes directly within your PDF files. With a simple toggle, you can open a side-by-side Markdown view, edit your notes, and have the updated content automatically re-embedded into your PDF.

## Features

- **Easy PDF Note-Taking:** Open your PDF and click the ribbon icon to toggle a Markdown side-by-side view.
- **Embedded Markdown Extraction:** Automatically extract an embedded `notes.md` from a PDF or create one if it doesn't exist.
- **Live Updates:** Changes made in the Markdown note are automatically re-embedded into the PDF.
- **Ribbon Icon & Command Palette:** Quick access via a dedicated ribbon icon and a command to extract Markdown.

## Installation

### From the Community Plugin List
1. Open Obsidian and navigate to **Settings → Community plugins**.
2. Disable **Safe mode** if it’s enabled.
3. Search for **PDF Markdown Plugin for Obsidian**.
4. Click **Install** and then **Enable**.

### Manual Installation
1. Clone this repository or download the latest release.
2. Copy the `main.js`, `styles.css`, and `manifest.json` files into your vault at:

## Usage

1. **Toggling the Markdown View:**
- Open a PDF file in Obsidian.
- Click the plugin’s ribbon icon (displayed as a dice icon).  
  - If the corresponding Markdown file (named with a `-notes.md` suffix) exists, it will open in a split view.
  - If not, the plugin will attempt to extract embedded Markdown from the PDF or create a new Markdown file.
2. **Extracting Markdown via Command:**
- Open the command palette (Cmd/Ctrl+P) and run **Extract Markdown from PDF (as file)**.
- The plugin will extract the Markdown attachment (if available) and open it in a new file.
3. **Automatic PDF Updates:**
- When you modify the associated Markdown file, the plugin automatically re-embeds the updated content back into the PDF file.
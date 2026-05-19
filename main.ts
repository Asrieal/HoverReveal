import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
} from "obsidian";
import {
	EditorView,
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	WidgetType,
} from "@codemirror/view";
import { Extension } from "@codemirror/state";

interface HoverRevealSettings {
	tooltipTextColor: string;
	tooltipBackgroundColor: string;
	tooltipBorderColor: string;
	boldTextColor: string;
}

interface HoverRevealMatch {
	fullMatch: string;
	visibleText: string;
	tooltipText: string;
	index: number;
}

const DEFAULT_SETTINGS: HoverRevealSettings = {
	tooltipTextColor: "var(--text-normal)",
	tooltipBackgroundColor: "var(--background-primary)",
	tooltipBorderColor: "var(--background-modifier-border)",
	boldTextColor: "var(--bold-color)",
};

const HOVER_RESET_DELAY = 200;
const PREVIEW_SKIP_SELECTOR =
	".hover-reveal-container, code, pre, script, style";

export default class HoverRevealPlugin extends Plugin {
	settings: HoverRevealSettings;

	async onload() {
		await this.loadSettings();
		this.updateStyles();

		this.addSettingTab(new HoverRevealSettingTab(this.app, this));

		this.registerMarkdownPostProcessor((element, context) =>
			this.processPreviewHoverReveal(element, context)
		);

		this.registerEditorExtension(this.hoverRevealExtension());

		// Register command for inserting hover reveal syntax
		this.addCommand({
			id: 'insert-hover-reveal',
			name: 'Insert Hover Reveal Syntax',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.insertHoverRevealSyntax(editor);
			}
		});

		// Register command for navigating within hover reveal syntax
		this.addCommand({
			id: 'navigate-hover-reveal',
			name: 'Navigate in Hover Reveal Syntax',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.navigateHoverRevealSyntax(editor);
			}
		});
	}

	onunload() {
		const oldStyle = document.getElementById("hover-reveal-custom-styles");
		if (oldStyle) {
			oldStyle.remove();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateStyles();
	}

	private shouldSkipPreviewElement(element: HTMLElement): boolean {
		return Boolean(element.closest(PREVIEW_SKIP_SELECTOR));
	}

	private async processPreviewHoverReveal(
		element: HTMLElement,
		context: MarkdownPostProcessorContext
	): Promise<void> {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
		const elementsToProcess: HTMLElement[] = [];
		let currentNode: Node | null;

		if (!this.shouldSkipPreviewElement(element)) {
			elementsToProcess.push(element);
		}

		while ((currentNode = walker.nextNode())) {
			if (!(currentNode instanceof HTMLElement)) {
				continue;
			}

			if (this.shouldSkipPreviewElement(currentNode)) {
				continue;
			}

			elementsToProcess.push(currentNode);
		}

		for (const currentElement of elementsToProcess.reverse()) {
			this.replacePreviewMatchesInElement(currentElement, context);
		}
	}

	private replacePreviewMatchesInElement(
		element: HTMLElement,
		context: MarkdownPostProcessorContext
	): void {
		if (this.shouldSkipPreviewElement(element)) {
			return;
		}

		const text = element.textContent;
		if (!text) {
			return;
		}

		const matches = this.parseHoverRevealMatches(text);
		if (matches.length === 0) {
			return;
		}

		for (const match of matches.reverse()) {
			this.replacePreviewMatch(element, match, context);
		}
	}

	private replacePreviewMatch(
		element: HTMLElement,
		match: HoverRevealMatch,
		context: MarkdownPostProcessorContext
	): void {
		const visibleText = match.visibleText;
		const tooltipText = match.tooltipText;
		const visibleStart = match.index + 1;
		const visibleEnd = visibleStart + visibleText.length;
		const tooltipStart = visibleEnd + 2;
		const tooltipEnd = tooltipStart + tooltipText.length;
		const fullEnd = match.index + match.fullMatch.length;

		const fullRange = this.createTextRange(element, match.index, fullEnd);
		if (!fullRange) {
			return;
		}

		const fullFragment = fullRange.extractContents();
		const tooltipFragment = this.extractFragmentContents(
			fullFragment,
			tooltipStart - match.index,
			tooltipEnd - match.index
		);
		const visibleFragment = this.extractFragmentContents(
			fullFragment,
			1,
			visibleEnd - match.index
		);

		const { container, trigger, tooltip } = this.createHoverRevealElement(
			"",
			false
		);
		trigger.insertBefore(visibleFragment, tooltip);
		tooltip.appendChild(tooltipFragment);
		fullRange.insertNode(container);
		context.addChild(new MarkdownRenderChild(container));
	}

	private createTextRange(
		root: Node,
		startOffset: number,
		endOffset: number
	): Range | null {
		const start = this.resolveTextPosition(root, startOffset);
		const end = this.resolveTextPosition(root, endOffset);
		if (!start || !end) {
			return null;
		}

		const range = document.createRange();
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
		return range;
	}

	private resolveTextPosition(
		root: Node,
		targetOffset: number
	): { node: Text; offset: number } | null {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let currentNode: Node | null;
		let remaining = targetOffset;
		let lastTextNode: Text | null = null;

		while ((currentNode = walker.nextNode())) {
			if (!(currentNode instanceof Text)) {
				continue;
			}

			lastTextNode = currentNode;
			const currentText = currentNode.textContent ?? "";
			if (remaining <= currentText.length) {
				return { node: currentNode, offset: remaining };
			}

			remaining -= currentText.length;
		}

		if (!lastTextNode) {
			return null;
		}

		return {
			node: lastTextNode,
			offset: lastTextNode.textContent?.length ?? 0,
		};
	}

	private extractFragmentContents(
		fragment: DocumentFragment,
		startOffset: number,
		endOffset: number
	): DocumentFragment {
		const range = this.createTextRange(fragment, startOffset, endOffset);
		if (!range) {
			return document.createDocumentFragment();
		}

		return range.extractContents();
	}

	private createHoverRevealElement(
		visibleText: string,
		renderVisibleMarkdown: boolean
	): {
		container: HTMLSpanElement;
		trigger: HTMLSpanElement;
		tooltip: HTMLDivElement;
	} {
		const container = document.createElement("span");
		container.classList.add("hover-reveal-container");

		const trigger = document.createElement("span");
		trigger.classList.add("hover-reveal");

		if (renderVisibleMarkdown) {
			const visibleContent = document.createElement("span");
			trigger.appendChild(visibleContent);
			void this.renderInlineMarkdown(visibleText, visibleContent, this);
		} else {
			trigger.textContent = visibleText;
		}

		const tooltip = document.createElement("div");
		tooltip.classList.add("hover-reveal-tooltip");
		trigger.appendChild(tooltip);
		container.appendChild(trigger);

		this.attachTooltipHoverHandlers(trigger, tooltip);

		return { container, trigger, tooltip };
	}

	private async renderInlineMarkdown(
		markdown: string,
		container: HTMLElement,
		component: Plugin | MarkdownRenderChild
	): Promise<void> {
		await MarkdownRenderer.render(this.app, markdown, container, "", component);
		const paragraph = container.firstElementChild;
		if (
			container.childElementCount === 1 &&
			paragraph instanceof HTMLParagraphElement
		) {
			container.innerHTML = paragraph.innerHTML;
		}
	}

	private async renderTooltipMarkdown(
		markdown: string,
		container: HTMLElement,
		sourcePath: string,
		component: Plugin | MarkdownRenderChild
	): Promise<void> {
		await MarkdownRenderer.render(
			this.app,
			markdown,
			container,
			sourcePath,
			component
		);
	}

	private attachTooltipHoverHandlers(
		trigger: HTMLElement,
		tooltip: HTMLElement
	): void {
		const adjustTooltipPosition = () => {
			const tooltipRect = tooltip.getBoundingClientRect();
			if (tooltipRect.width === 0) {
				return;
			}

			const mainContentArea = document.querySelector(
				".workspace-split.mod-vertical.mod-root"
			) as HTMLElement | null;
			if (!mainContentArea) {
				return;
			}

			const mainContentRect = mainContentArea.getBoundingClientRect();
			if (tooltipRect.left < mainContentRect.left) {
				tooltip.style.left = "0";
				tooltip.style.right = "auto";
				tooltip.style.transform = "translateX(0)";
			} else if (tooltipRect.right > mainContentRect.right) {
				tooltip.style.left = "auto";
				tooltip.style.right = "0";
				tooltip.style.transform = "translateX(0)";
			}
		};

		const resetTooltipPosition = () => {
			tooltip.style.left = "50%";
			tooltip.style.right = "auto";
			tooltip.style.transform = "translateX(-50%)";
			tooltip.style.visibility = "";
			tooltip.style.opacity = "";
		};

		const hideTooltip = (event: MouseEvent) => {
			const relatedTarget = event.relatedTarget;
			if (
				relatedTarget instanceof Node &&
				(trigger.contains(relatedTarget) || tooltip.contains(relatedTarget))
			) {
				return;
			}

			tooltip.style.visibility = "hidden";
			tooltip.style.opacity = "0";

			window.setTimeout(() => {
				if (trigger.matches(":hover") || tooltip.matches(":hover")) {
					return;
				}

				resetTooltipPosition();
			}, HOVER_RESET_DELAY);
		};

		trigger.addEventListener("mouseenter", adjustTooltipPosition);
		trigger.addEventListener("mouseleave", hideTooltip);
		tooltip.addEventListener("mouseenter", adjustTooltipPosition);
		tooltip.addEventListener("mouseleave", hideTooltip);
	}

	// Method to insert hover reveal syntax
	private insertHoverRevealSyntax(editor: Editor): void {
		const cursor = editor.getCursor();
		const selectedText = editor.getSelection();
		
		if (selectedText) {
			// If text is selected, wrap it as visible text and add empty tooltip
			const hoverSyntax = `[${selectedText}]{}`;
			editor.replaceSelection(hoverSyntax);
			
			// Position cursor inside the tooltip brackets for immediate editing
			// Use current cursor position after replacement (which is at the end of inserted text)
			const currentCursor = editor.getCursor();
			const newCursor = {
				line: currentCursor.line,
				ch: currentCursor.ch - 1 // Move back one position to be inside {}
			};
			editor.setCursor(newCursor);
			
			// Show a notice to guide the user
			new Notice('Hover syntax inserted! Type your tooltip text.');
		} else {
			// If no text is selected, insert template and position cursor
			const hoverSyntax = `[]{}`;
			editor.replaceRange(hoverSyntax, cursor);
			
			// Position cursor inside the visible text brackets
			const newCursor = {
				line: cursor.line,
				ch: cursor.ch + 1 // Position inside [
			};
			editor.setCursor(newCursor);
			
			// Show a notice to guide the user
			new Notice('Hover syntax inserted! Type visible text, then Tab to tooltip.');
		}
	}

	// Method to navigate within hover reveal syntax
	private navigateHoverRevealSyntax(editor: Editor): void {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		const matches = this.parseHoverRevealMatches(line);
		let foundMatch: {
			visibleText: string;
			tooltipText: string;
			start: number;
			end: number;
			visibleStart: number;
			visibleEnd: number;
			tooltipStart: number;
			tooltipEnd: number;
		} | null = null;

		for (const match of matches) {
			const matchStart = match.index;
			const matchEnd = match.index + match.fullMatch.length;

			if (cursor.ch >= matchStart && cursor.ch <= matchEnd) {
				foundMatch = {
					visibleText: match.visibleText,
					tooltipText: match.tooltipText,
					start: matchStart,
					end: matchEnd,
					visibleStart: matchStart + 1,
					visibleEnd: matchStart + 1 + match.visibleText.length,
					tooltipStart: matchStart + match.visibleText.length + 3,
					tooltipEnd:
						matchStart + match.visibleText.length + 3 + match.tooltipText.length,
				};
				break;
			}
		}
		
		if (foundMatch) {
			// Determine current position and navigate accordingly
			if (cursor.ch >= foundMatch.visibleStart && cursor.ch <= foundMatch.visibleEnd) {
				// Currently in visible text, move to tooltip
				editor.setCursor({
					line: cursor.line,
					ch: foundMatch.tooltipStart
				});
				new Notice('Moved to tooltip text area');
			} else if (cursor.ch >= foundMatch.tooltipStart && cursor.ch <= foundMatch.tooltipEnd) {
				// Currently in tooltip, move to visible text
				editor.setCursor({
					line: cursor.line,
					ch: foundMatch.visibleStart
				});
				new Notice('Moved to visible text area');
			} else {
				// Cursor is at brackets, move to visible text by default
				editor.setCursor({
					line: cursor.line,
					ch: foundMatch.visibleStart
				});
				new Notice('Moved to visible text area');
			}
		} else {
			new Notice('No hover reveal syntax found at cursor position');
		}
	}

	private parseHoverRevealMatches(text: string): HoverRevealMatch[] {
		const matches: HoverRevealMatch[] = [];
		let index = 0;

		while (index < text.length) {
			const openBracket = text.indexOf("[", index);
			if (openBracket === -1) {
				break;
			}

			if (openBracket > 0 && text[openBracket - 1] === "[") {
				index = openBracket + 1;
				continue;
			}

			let closeBracket = openBracket + 1;
			let invalidVisible = false;
			for (; closeBracket < text.length; closeBracket += 1) {
				const char = text[closeBracket];
				if (char === "]") {
					break;
				}
				if (char === "[" || char === "{" || char === "}") {
					invalidVisible = true;
					break;
				}
			}

			if (invalidVisible || closeBracket >= text.length) {
				index = openBracket + 1;
				continue;
			}

			const braceStart = closeBracket + 1;
			if (text[braceStart] !== "{") {
				index = closeBracket + 1;
				continue;
			}

			let depth = 1;
			let cursor = braceStart + 1;
			for (; cursor < text.length && depth > 0; cursor += 1) {
				const char = text[cursor];
				if (char === "{") {
					depth += 1;
				} else if (char === "}") {
					depth -= 1;
				}
			}

			if (depth !== 0) {
				index = openBracket + 1;
				continue;
			}

			const visibleText = text.slice(openBracket + 1, closeBracket);
			const tooltipText = text.slice(braceStart + 1, cursor - 1);
			const fullMatch = text.slice(openBracket, cursor);

			matches.push({
				fullMatch,
				visibleText,
				tooltipText,
				index: openBracket,
			});

			index = cursor;
		}

		return matches;
	}

	private hoverRevealExtension(): Extension {
		const plugin = this;
		class TooltipWidget extends WidgetType {
			constructor(
				readonly visibleText: string,
				readonly tooltipText: string,
				readonly from: number,
				readonly to: number,
				readonly view: EditorView,
				readonly isActive: boolean
			) {
				super();
			}

			toDOM() {
				const span = document.createElement("span");
			
				if (this.isActive) {
					span.textContent = `[${this.visibleText}]{${this.tooltipText}}`;
				} else {
					const { container, tooltip } = plugin.createHoverRevealElement(
						this.visibleText,
						true
					);
					void plugin.renderTooltipMarkdown(
						this.tooltipText,
						tooltip,
						"",
						plugin
					);
					return container;
				}
				
				return span;
			}

			eq(other: TooltipWidget): boolean {
				return (
					other.visibleText === this.visibleText &&
					other.tooltipText === this.tooltipText &&
					other.from === this.from &&
					other.to === this.to &&
					other.isActive === this.isActive
				);
			}
		}

		const tooltipPlugin = ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = this.buildDecorations(view);
				}

				update(update: ViewUpdate) {
					if (
						update.docChanged ||
						update.viewportChanged ||
						update.selectionSet
					) {
						this.decorations = this.buildDecorations(update.view);
					}
				}

				buildDecorations(view: EditorView) {
					const widgets = [];
					const content = view.state.doc.toString();
					const matches = plugin.parseHoverRevealMatches(content);

					for (const match of matches) {
						const { fullMatch, visibleText, tooltipText } = match;
						const from = match.index;
						const to = from + fullMatch.length;

						const cursor = view.state.selection.main.from;

						const isCursorInside = cursor >= from && cursor <= to;

						if (isCursorInside) { /* empty */ } else {
							widgets.push(
								Decoration.replace({
									widget: new TooltipWidget(
										visibleText,
										tooltipText,
										from,
										to,
										view,
										false
									),
									inclusive: true,
								}).range(from, to)
							);
						}
					}

					return Decoration.set(widgets);
				}
			},
			{
				decorations: (v) => v.decorations as DecorationSet,
			}
		);

		return [tooltipPlugin];
	}

	updateStyles() {
		const style = document.createElement("style");
		style.id = "hover-reveal-custom-styles";
		style.textContent = `
			.hover-reveal-tooltip {
				color: ${this.settings.tooltipTextColor} !important;
				background-color: ${this.settings.tooltipBackgroundColor} !important;
				border-color: ${this.settings.tooltipBorderColor} !important;
			}
			.hover-reveal-tooltip::after {
				border-top-color: ${this.settings.tooltipBackgroundColor} !important;
			}
			.hover-reveal {
				color: ${this.settings.boldTextColor} !important;
			}
		`;

		const oldStyle = document.getElementById("hover-reveal-custom-styles");
		if (oldStyle) {
			oldStyle.remove();
		}

		document.head.appendChild(style);
	}
}

class HoverRevealSettingTab extends PluginSettingTab {
	plugin: HoverRevealPlugin;

	constructor(app: App, plugin: HoverRevealPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private getComputedColor(cssVar: string): string {
		// Create a temporary element to get computed color
		const temp = document.createElement("div");
		document.body.appendChild(temp);
		temp.style.color = cssVar;

		// Get computed color
		const computedColor = getComputedStyle(temp).color;
		document.body.removeChild(temp);

		// Convert rgb to hexadecimal
		if (computedColor.startsWith("rgb")) {
			const [r, g, b] = computedColor.match(/\d+/g)?.map(Number) || [
				0, 0, 0,
			];
			return `#${r.toString(16).padStart(2, "0")}${g
				.toString(16)
				.padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
		}

		return computedColor || cssVar;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Add reset setting at the top
		new Setting(containerEl)
			.setName("Reset settings")
			.setDesc("Reset all settings to default values")
			.addButton((button) =>
				button.setButtonText("Reset").onClick(async () => {
					// Reset to default settings
					this.plugin.settings.tooltipTextColor =
						DEFAULT_SETTINGS.tooltipTextColor;
					this.plugin.settings.tooltipBackgroundColor =
						DEFAULT_SETTINGS.tooltipBackgroundColor;
					this.plugin.settings.tooltipBorderColor =
						DEFAULT_SETTINGS.tooltipBorderColor;
					this.plugin.settings.boldTextColor =
						DEFAULT_SETTINGS.boldTextColor;

					// Save settings
					await this.plugin.saveSettings();

					// Update UI
					this.display();

					// Show notification
					new Notice("Reset settings to default");
				})
			);

		// Text color setting
		let textColorText: any;
		let textColorPicker: any;
		const computedTextColor = this.getComputedColor(
			this.plugin.settings.tooltipTextColor
		);
		new Setting(containerEl)
			.setName("Tooltip text color")
			.setDesc("Set the text color of the tooltip")
			.addText((text) => {
				textColorText = text
					.setPlaceholder("var(--text-normal)")
					.setValue(computedTextColor)
					.onChange(async (value) => {
						this.plugin.settings.tooltipTextColor = value;
						textColorPicker.setValue(value);
						await this.plugin.saveSettings();
					});
				return textColorText;
			})
			.addColorPicker((color) => {
				textColorPicker = color
					.setValue(computedTextColor)
					.onChange(async (value) => {
						this.plugin.settings.tooltipTextColor = value;
						textColorText.setValue(value);
						await this.plugin.saveSettings();
					});
				return textColorPicker;
			});

		// Background color setting
		let bgColorText: any;
		let bgColorPicker: any;
		const computedBgColor = this.getComputedColor(
			this.plugin.settings.tooltipBackgroundColor
		);
		new Setting(containerEl)
			.setName("Tooltip background color")
			.setDesc("Set the background color of the tooltip")
			.addText((text) => {
				bgColorText = text
					.setPlaceholder("var(--background-primary)")
					.setValue(computedBgColor)
					.onChange(async (value) => {
						this.plugin.settings.tooltipBackgroundColor = value;
						bgColorPicker.setValue(value);
						await this.plugin.saveSettings();
					});
				return bgColorText;
			})
			.addColorPicker((color) => {
				bgColorPicker = color
					.setValue(computedBgColor)
					.onChange(async (value) => {
						this.plugin.settings.tooltipBackgroundColor = value;
						bgColorText.setValue(value);
						await this.plugin.saveSettings();
					});
				return bgColorPicker;
			});

		// Border color setting
		let borderColorText: any;
		let borderColorPicker: any;
		const computedBorderColor = this.getComputedColor(
			this.plugin.settings.tooltipBorderColor
		);
		new Setting(containerEl)
			.setName("Tooltip border color")
			.setDesc("Set the border color of the tooltip")
			.addText((text) => {
				borderColorText = text
					.setPlaceholder("var(--background-modifier-border)")
					.setValue(computedBorderColor)
					.onChange(async (value) => {
						this.plugin.settings.tooltipBorderColor = value;
						borderColorPicker.setValue(value);
						await this.plugin.saveSettings();
					});
				return borderColorText;
			})
			.addColorPicker((color) => {
				borderColorPicker = color
					.setValue(computedBorderColor)
					.onChange(async (value) => {
						this.plugin.settings.tooltipBorderColor = value;
						borderColorText.setValue(value);
						await this.plugin.saveSettings();
					});
				return borderColorPicker;
			});

		// Bold text color setting
		let boldColorText: any;
		let boldColorPicker: any;
		const computedBoldColor = this.getComputedColor(
			this.plugin.settings.boldTextColor
		);
		new Setting(containerEl)
			.setName("Bold text color")
			.setDesc("Set the color of the bold text")
			.addText((text) => {
				boldColorText = text
					.setPlaceholder("var(--bold-color)")
					.setValue(computedBoldColor)
					.onChange(async (value) => {
						this.plugin.settings.boldTextColor = value;
						boldColorPicker.setValue(value);
						await this.plugin.saveSettings();
					});
				return boldColorText;
			})
			.addColorPicker((color) => {
				boldColorPicker = color
					.setValue(computedBoldColor)
					.onChange(async (value) => {
						this.plugin.settings.boldTextColor = value;
						boldColorText.setValue(value);
						await this.plugin.saveSettings();
					});
				return boldColorPicker;
			});
	}
}

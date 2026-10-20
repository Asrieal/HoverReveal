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

const DEFAULT_SETTINGS: HoverRevealSettings = {
	tooltipTextColor: "var(--text-normal)",
	tooltipBackgroundColor: "var(--background-primary)",
	tooltipBorderColor: "var(--background-modifier-border)",
	boldTextColor: "var(--bold-color)",
};

const HOVER_REVEAL_REGEX = /(?<!\[)\[([^[\]{}]+)\]\{([^}]*)\}/g;
const HOVER_RESET_DELAY = 200;
const PREVIEW_SKIP_SELECTOR =
	".hover-reveal-container, code, pre, script, style";

export default class HoverRevealPlugin extends Plugin {
	settings: HoverRevealSettings;
	private portalEl: HTMLElement | null = null;
	private activeTrigger: HTMLElement | null = null;
	private activeTooltip: HTMLElement | null = null;
	private hideTimeout: number | null = null;
	private boundHandleScrollOrResize: ((e: Event) => void) | null = null;
	private boundHandleKeyDown: ((e: KeyboardEvent) => void) | null = null;

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

		// Global scroll and resize listeners to track trigger position
		this.boundHandleScrollOrResize = (e: Event) => {
			if (!this.activeTooltip || !this.activeTrigger) {
				return;
			}
			if (e.target instanceof Node && this.activeTooltip.contains(e.target)) {
				return;
			}

			const triggerRect = this.activeTrigger.getBoundingClientRect();
			if (
				!this.activeTrigger.isConnected ||
				triggerRect.bottom < 0 ||
				triggerRect.top > window.innerHeight ||
				triggerRect.right < 0 ||
				triggerRect.left > window.innerWidth
			) {
				this.immediateHideActiveTooltip();
			} else {
				this.repositionActiveTooltip();
			}
		};

		this.boundHandleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && this.activeTooltip) {
				this.immediateHideActiveTooltip();
			}
		};

		window.addEventListener('scroll', this.boundHandleScrollOrResize, {
			capture: true,
			passive: true,
		});
		window.addEventListener('resize', this.boundHandleScrollOrResize, {
			passive: true,
		});
		window.addEventListener('keydown', this.boundHandleKeyDown);
	}

	onunload() {
		if (this.boundHandleScrollOrResize) {
			window.removeEventListener('scroll', this.boundHandleScrollOrResize, {
				capture: true,
			});
			window.removeEventListener('resize', this.boundHandleScrollOrResize);
		}
		if (this.boundHandleKeyDown) {
			window.removeEventListener('keydown', this.boundHandleKeyDown);
		}

		this.immediateHideActiveTooltip();

		if (this.portalEl) {
			this.portalEl.remove();
			this.portalEl = null;
		}

		const oldStyle = document.getElementById('hover-reveal-custom-styles');
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

	private createHoverRevealRegex(): RegExp {
		return new RegExp(HOVER_REVEAL_REGEX.source, HOVER_REVEAL_REGEX.flags);
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

		const regex = this.createHoverRevealRegex();
		const matches = Array.from(text.matchAll(regex));
		if (matches.length === 0) {
			return;
		}

		for (const match of matches.reverse()) {
			this.replacePreviewMatch(element, match, context);
		}
	}

	private replacePreviewMatch(
		element: HTMLElement,
		match: RegExpMatchArray,
		context: MarkdownPostProcessorContext
	): void {
		if (match.index === undefined) {
			return;
		}

		const visibleText = match[1];
		const tooltipText = match[2];
		const visibleStart = match.index + 1;
		const visibleEnd = visibleStart + visibleText.length;
		const tooltipStart = visibleEnd + 2;
		const tooltipEnd = tooltipStart + tooltipText.length;
		const fullEnd = match.index + match[0].length;

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
		if (this.activeTooltip === container) {
			this.repositionActiveTooltip();
		}
	}

	private getOrCreatePortal(): HTMLElement {
		if (this.portalEl && this.portalEl.isConnected) {
			return this.portalEl;
		}
		let portal = document.getElementById("hover-reveal-portal");
		if (!portal) {
			portal = document.createElement("div");
			portal.id = "hover-reveal-portal";
			document.body.appendChild(portal);
		}
		this.portalEl = portal;
		return portal;
	}

	private showTooltip(trigger: HTMLElement, tooltip: HTMLElement): void {
		this.cancelHideTooltip();

		if (this.activeTooltip && this.activeTooltip !== tooltip) {
			this.immediateHideActiveTooltip();
		}

		this.activeTrigger = trigger;
		this.activeTooltip = tooltip;

		const portal = this.getOrCreatePortal();
		if (tooltip.parentElement !== portal) {
			portal.appendChild(tooltip);
		}

		tooltip.classList.remove("hover-reveal-tooltip-hidden", "hover-reveal-fade-out");
		tooltip.classList.add("hover-reveal-fade-in");

		this.repositionActiveTooltip();
	}

	private scheduleHideTooltip(): void {
		this.cancelHideTooltip();
		this.hideTimeout = window.setTimeout(() => {
			this.hideActiveTooltip();
		}, HOVER_RESET_DELAY);
	}

	private cancelHideTooltip(): void {
		if (this.hideTimeout !== null) {
			window.clearTimeout(this.hideTimeout);
			this.hideTimeout = null;
		}
	}

	private hideActiveTooltip(): void {
		if (!this.activeTooltip) {
			return;
		}

		const tooltip = this.activeTooltip;
		tooltip.classList.remove("hover-reveal-fade-in");
		tooltip.classList.add("hover-reveal-fade-out");

		this.hideTimeout = window.setTimeout(() => {
			this.immediateHideActiveTooltip();
		}, 150);
	}

	private immediateHideActiveTooltip(): void {
		this.cancelHideTooltip();
		if (!this.activeTooltip) {
			return;
		}

		const tooltip = this.activeTooltip;
		const trigger = this.activeTrigger;

		tooltip.classList.remove("hover-reveal-fade-in", "hover-reveal-fade-out", "is-top", "is-bottom");
		tooltip.classList.add("hover-reveal-tooltip-hidden");

		if (trigger && trigger.isConnected) {
			trigger.appendChild(tooltip);
		} else {
			tooltip.remove();
		}

		this.activeTrigger = null;
		this.activeTooltip = null;
	}

	private repositionActiveTooltip(): void {
		if (!this.activeTrigger || !this.activeTooltip) {
			return;
		}

		if (!this.activeTrigger.isConnected) {
			this.immediateHideActiveTooltip();
			return;
		}

		const triggerRect = this.activeTrigger.getBoundingClientRect();
		const tooltip = this.activeTooltip;

		if (triggerRect.width === 0 && triggerRect.height === 0) {
			return;
		}

		const tooltipRect = tooltip.getBoundingClientRect();
		const tooltipWidth = tooltipRect.width;
		const tooltipHeight = tooltipRect.height;
		if (tooltipWidth === 0 && tooltipHeight === 0) {
			return;
		}

		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const GAP = 8;
		const MARGIN = 10;

		const spaceAbove = triggerRect.top;
		const spaceBelow = viewportHeight - triggerRect.bottom;

		let placeBelow = false;
		if (spaceAbove < tooltipHeight + GAP + MARGIN && spaceBelow >= tooltipHeight + GAP + MARGIN) {
			placeBelow = true;
		} else if (spaceAbove < tooltipHeight + GAP + MARGIN && spaceBelow > spaceAbove) {
			placeBelow = true;
		}

		let top: number;
		if (placeBelow) {
			top = triggerRect.bottom + GAP;
			tooltip.classList.add("is-bottom");
			tooltip.classList.remove("is-top");
		} else {
			top = triggerRect.top - tooltipHeight - GAP;
			tooltip.classList.add("is-top");
			tooltip.classList.remove("is-bottom");
		}

		let left = triggerRect.left + (triggerRect.width - tooltipWidth) / 2;
		if (left < MARGIN) {
			left = MARGIN;
		} else if (left + tooltipWidth > viewportWidth - MARGIN) {
			left = viewportWidth - MARGIN - tooltipWidth;
		}

		const triggerCenter = triggerRect.left + triggerRect.width / 2;
		let arrowLeft = triggerCenter - left;
		const minArrow = 12;
		const maxArrow = Math.max(minArrow, tooltipWidth - 12);
		arrowLeft = Math.max(minArrow, Math.min(maxArrow, arrowLeft));

		tooltip.style.setProperty("--arrow-left", `${Math.round(arrowLeft)}px`);
		tooltip.style.top = `${Math.round(top)}px`;
		tooltip.style.left = `${Math.round(left)}px`;
	}

	private attachTooltipHoverHandlers(
		trigger: HTMLElement,
		tooltip: HTMLElement
	): void {
		tooltip.classList.add("hover-reveal-tooltip-hidden");

		const onMouseEnter = () => {
			this.showTooltip(trigger, tooltip);
		};

		const onMouseLeave = (event: MouseEvent) => {
			const relatedTarget = event.relatedTarget;
			if (
				relatedTarget instanceof Node &&
				(trigger.contains(relatedTarget) || tooltip.contains(relatedTarget))
			) {
				return;
			}
			this.scheduleHideTooltip();
		};

		trigger.addEventListener("mouseenter", onMouseEnter);
		trigger.addEventListener("mouseleave", onMouseLeave);

		tooltip.addEventListener("mouseenter", () => {
			this.cancelHideTooltip();
		});

		tooltip.addEventListener("mouseleave", (event: MouseEvent) => {
			const relatedTarget = event.relatedTarget;
			if (
				relatedTarget instanceof Node &&
				(trigger.contains(relatedTarget) || tooltip.contains(relatedTarget))
			) {
				return;
			}
			this.scheduleHideTooltip();
		});
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
		
		// Find hover reveal syntax on current line
		const regex = /\[([^[\]{}]*)\]\{([^}]*)\}/g;
		let match;
		let foundMatch = null;
		
		while ((match = regex.exec(line)) !== null) {
			const matchStart = match.index;
			const matchEnd = match.index + match[0].length;
			
			// Check if cursor is within this match
			if (cursor.ch >= matchStart && cursor.ch <= matchEnd) {
				foundMatch = {
					fullMatch: match[0],
					visibleText: match[1],
					tooltipText: match[2],
					start: matchStart,
					end: matchEnd,
					visibleStart: matchStart + 1, // After [
					visibleEnd: matchStart + 1 + match[1].length, // Before ]
					tooltipStart: matchStart + match[1].length + 3, // After ]{
					tooltipEnd: matchStart + match[1].length + 3 + match[2].length // Before }
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
					const regex = plugin.createHoverRevealRegex();
					let match;

					while ((match = regex.exec(content)) !== null) {
						const [fullMatch, visibleText, tooltipText] = match;
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
			.hover-reveal-tooltip.is-top::after,
			.hover-reveal-tooltip:not(.is-bottom)::after {
				border-top-color: ${this.settings.tooltipBackgroundColor} !important;
			}
			.hover-reveal-tooltip.is-bottom::after {
				border-bottom-color: ${this.settings.tooltipBackgroundColor} !important;
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

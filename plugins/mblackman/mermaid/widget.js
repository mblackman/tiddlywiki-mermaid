/*\
title: $:/plugins/mblackman/mermaid/widget.js
type: application/javascript
module-type: widget

Offline Mermaid v11+ Async Widget for TiddlyWiki5
\*/
(function() {
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var diagramCounter = 0;
var renderQueue = Promise.resolve();

function queueRender(renderFn) {
	var next = renderQueue.then(renderFn, renderFn);
	renderQueue = next.catch(function() {});
	return next;
}

var MermaidWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
	this.renderGeneration = 0;
};

MermaidWidget.prototype = new Widget();

MermaidWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();

	var container = this.document.createElement("div");
	var classes = ["tc-mermaid-container"];
	if(this.align) {
		classes.push("tc-mermaid-align-" + this.align);
	}
	if(this.customClass) {
		classes.push(this.customClass);
	}
	container.className = classes.join(" ");

	parent.insertBefore(container, nextSibling);
	this.domNodes.push(container);

	if($tw.browser && this.sourceText && this.sourceText.trim()) {
		this.renderDiagram(container);
	}
};

MermaidWidget.prototype.extractText = function(node) {
	if(!node) {
		return "";
	}
	if(node.type === "text") {
		return node.text || "";
	}
	if(node.type === "entity") {
		// TiddlyWiki WikiText dash rule transforms '--' to &ndash; and '---' to &mdash;
		// Mermaid syntax strictly requires ASCII hyphens for arrows (-->) and links (---)
		if(node.entity === "&ndash;") {
			return "--";
		}
		if(node.entity === "&mdash;") {
			return "---";
		}
		return $tw.utils.entityDecode(node.entity || "");
	}
	if(node.type === "element" && node.tag === "br") {
		return "\n";
	}
	if(node.children && node.children.length > 0) {
		var parts = [];
		for(var i = 0; i < node.children.length; i++) {
			parts.push(this.extractText(node.children[i]));
		}
		var text = parts.join("");
		if(node.type === "element" && (node.tag === "p" || node.tag === "div")) {
			return text + "\n";
		}
		return text;
	}
	return "";
};

MermaidWidget.prototype.execute = function() {
	this.sourceText = this.getAttribute("text", "");
	if(!this.sourceText) {
		this.sourceText = this.getAttribute("source", "");
	}
	// Fallback to inline text children if attributes are omitted
	if(!this.sourceText && this.parseTreeNode && this.parseTreeNode.children) {
		var textParts = [];
		for(var i = 0; i < this.parseTreeNode.children.length; i++) {
			textParts.push(this.extractText(this.parseTreeNode.children[i]));
		}
		if(textParts.length > 0) {
			this.sourceText = textParts.join("");
		}
	}

	this.themeAttr = this.getAttribute("theme", "auto");
	this.align = this.getAttribute("align", "");
	this.customClass = this.getAttribute("class", "");
	this.securityLevel = this.getAttribute("security-level", "");
};

MermaidWidget.prototype.isDarkMode = function() {
	var currentPalette = this.wiki.getTiddlerText("$:/Palette");
	if(currentPalette) {
		var paletteTiddler = this.wiki.getTiddler(currentPalette.trim());
		if(paletteTiddler && paletteTiddler.fields) {
			var scheme = paletteTiddler.fields["color-scheme"];
			if(scheme === "dark") {
				return true;
			}
			if(scheme === "light") {
				return false;
			}
		}
		var lowerName = currentPalette.toLowerCase();
		if(lowerName.indexOf("dark") !== -1 || lowerName.indexOf("night") !== -1 || lowerName.indexOf("black") !== -1) {
			return true;
		}
	}
	if(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
		return true;
	}
	return false;
};

MermaidWidget.prototype.resolveTheme = function() {
	var theme = this.themeAttr;
	if(!theme || theme === "auto") {
		var configTheme = this.wiki.getTiddlerText("$:/config/mblackman/mermaid/theme", "auto").trim();
		if(configTheme && configTheme !== "auto") {
			theme = configTheme;
		} else {
			theme = this.isDarkMode() ? "dark" : "default";
		}
	}
	return theme;
};

MermaidWidget.prototype.cleanOrphan = function(id) {
	if(typeof document !== "undefined") {
		var orphan1 = document.getElementById("d" + id);
		if(orphan1 && orphan1.parentNode) {
			orphan1.parentNode.removeChild(orphan1);
		}
		var orphan2 = document.getElementById(id);
		if(orphan2 && orphan2.parentNode && orphan2.parentNode === document.body) {
			orphan2.parentNode.removeChild(orphan2);
		}
	}
};

MermaidWidget.prototype.showError = function(container, message) {
	var escapedMsg = $tw.utils.htmlTextEncode(message);
	container.innerHTML = '<div class="tc-mermaid-error" role="alert">' +
		'<div class="tc-mermaid-error-title">Mermaid Syntax Error</div>' +
		'<pre class="tc-mermaid-error-message">' + escapedMsg + '</pre>' +
		'</div>';
};

MermaidWidget.prototype.renderDiagram = function(container) {
	var self = this;
	if(!$tw.browser || !this.sourceText || !this.sourceText.trim()) {
		return;
	}

	var currentGen = ++this.renderGeneration;
	var mermaid;
	try {
		mermaid = require("$:/plugins/mblackman/mermaid/mermaid.min.js");
	} catch(err) {
		self.showError(container, "Failed to load Mermaid library: " + (err.message || err));
		return;
	}

	var mermaidApi = mermaid.default || mermaid;
	var effectiveTheme = this.resolveTheme();
	var effectiveSecurity = this.securityLevel || this.wiki.getTiddlerText("$:/config/mblackman/mermaid/securityLevel", "loose").trim();
	var id = "mermaid-svg-" + (++diagramCounter);

	queueRender(function() {
		if(self.renderGeneration !== currentGen) {
			return Promise.resolve();
		}
		try {
			mermaidApi.initialize({
				startOnLoad: false,
				theme: effectiveTheme,
				securityLevel: effectiveSecurity
			});
		} catch(initErr) {
			// ignore initialization errors
		}

		return mermaidApi.render(id, self.sourceText.trim())
			.then(function(result) {
				if(self.renderGeneration !== currentGen) {
					self.cleanOrphan(id);
					return;
				}
				container.innerHTML = result.svg;
				if(result.bindFunctions) {
					try {
						result.bindFunctions(container);
					} catch(bindErr) {
						// ignore bind functions error if non-fatal
					}
				}
				self.cleanOrphan(id);
			})
			.catch(function(err) {
				if(self.renderGeneration !== currentGen) {
					self.cleanOrphan(id);
					return;
				}
				self.cleanOrphan(id);
				self.showError(container, err.message || String(err));
			});
	});
};

MermaidWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(
		changedAttributes.text ||
		changedAttributes.source ||
		changedAttributes.theme ||
		changedAttributes.align ||
		changedAttributes["class"] ||
		changedAttributes["security-level"] ||
		changedTiddlers["$:/Palette"] ||
		changedTiddlers["$:/config/mblackman/mermaid/theme"] ||
		changedTiddlers["$:/config/mblackman/mermaid/securityLevel"]
	) {
		this.refreshSelf();
		return true;
	}
	return false;
};

exports.mermaid = MermaidWidget;

})();

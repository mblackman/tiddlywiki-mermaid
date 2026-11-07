/*\
title: $:/plugins/mblackman/mermaid/widget.js
type: application/javascript
module-type: widget

Offline Mermaid v11+ Async Widget for TiddlyWiki5
Supports dynamic TiddlyWiki palette coloring and legibility-first themes
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

// ---------------------------------------------------------------------------
// Color Math & WCAG Contrast Helpers
// ---------------------------------------------------------------------------

function parseToRgb(str) {
	if(!str) {
		return null;
	}
	str = str.trim();
	if($tw.utils && $tw.utils.parseCSSColor) {
		var parsed = $tw.utils.parseCSSColor(str);
		if(parsed) {
			return parsed; // [r, g, b, a]
		}
	}
	// Fallback simple #rgb and #rrggbb parsing
	if(str.charAt(0) === "#") {
		var hex = str.slice(1);
		if(hex.length === 3) {
			return [
				parseInt(hex.charAt(0) + hex.charAt(0), 16),
				parseInt(hex.charAt(1) + hex.charAt(1), 16),
				parseInt(hex.charAt(2) + hex.charAt(2), 16),
				1
			];
		}
		if(hex.length === 6) {
			return [
				parseInt(hex.slice(0, 2), 16),
				parseInt(hex.slice(2, 4), 16),
				parseInt(hex.slice(4, 6), 16),
				1
			];
		}
	}
	return null;
}

function rgbToHex(r, g, b) {
	var hr = Math.round(Math.max(0, Math.min(255, r))).toString(16).padStart(2, "0");
	var hg = Math.round(Math.max(0, Math.min(255, g))).toString(16).padStart(2, "0");
	var hb = Math.round(Math.max(0, Math.min(255, b))).toString(16).padStart(2, "0");
	return "#" + hr + hg + hb;
}

function blendRgb(fgRgba, bgRgb) {
	var a = fgRgba[3];
	if(a === undefined || a === null) {
		a = 1;
	}
	var r = fgRgba[0] * a + bgRgb[0] * (1 - a);
	var g = fgRgba[1] * a + bgRgb[1] * (1 - a);
	var b = fgRgba[2] * a + bgRgb[2] * (1 - a);
	return [r, g, b, 1];
}

function colorToHex(colorStr, bgRgb, fallbackHex) {
	var parsed = parseToRgb(colorStr);
	if(!parsed) {
		return fallbackHex;
	}
	if(parsed[3] !== undefined && parsed[3] < 1 && bgRgb) {
		parsed = blendRgb(parsed, bgRgb);
	}
	return rgbToHex(parsed[0], parsed[1], parsed[2]);
}

function getLuminance(r, g, b) {
	var a = [r, g, b].map(function(v) {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	});
	return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrastRatio(rgb1, rgb2) {
	var l1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
	var l2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
	var lighter = Math.max(l1, l2);
	var darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

function getBestTextColor(bgHex, lightHex, darkHex) {
	lightHex = lightHex || "#ffffff";
	darkHex = darkHex || "#111113";
	var bgRgb = parseToRgb(bgHex);
	if(!bgRgb) {
		return darkHex;
	}
	var lightRgb = parseToRgb(lightHex);
	var darkRgb = parseToRgb(darkHex);
	var crLight = getContrastRatio(bgRgb, lightRgb);
	var crDark = getContrastRatio(bgRgb, darkRgb);
	return crLight >= crDark ? lightHex : darkHex;
}

function hslToRgb(h, s, l) {
	h = (((h % 360) + 360) % 360) / 360;
	s = Math.max(0, Math.min(1, s));
	l = Math.max(0, Math.min(1, l));
	var r, g, b;
	if(s === 0) {
		r = g = b = l;
	} else {
		var hue2rgb = function(p, q, t) {
			if(t < 0) t += 1;
			if(t > 1) t -= 1;
			if(t < 1/6) return p + (q - p) * 6 * t;
			if(t < 1/2) return q;
			if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
			return p;
		};
		var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		var p = 2 * l - q;
		r = hue2rgb(p, q, h + 1/3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1/3);
	}
	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 1];
}

function rgbToHsl(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	var max = Math.max(r, g, b), min = Math.min(r, g, b);
	var h, s, l = (max + min) / 2;
	if(max === min) {
		h = s = 0;
	} else {
		var d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch(max) {
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}
	return [h * 360, s, l];
}

function mixHex(hex1, hex2, weight) {
	var rgb1 = parseToRgb(hex1) || [0, 0, 0];
	var rgb2 = parseToRgb(hex2) || [255, 255, 255];
	var w = Math.max(0, Math.min(1, weight));
	var r = rgb1[0] * (1 - w) + rgb2[0] * w;
	var g = rgb1[1] * (1 - w) + rgb2[1] * w;
	var b = rgb1[2] * (1 - w) + rgb2[2] * w;
	return rgbToHex(r, g, b);
}

function getPaletteColor(wiki, name, visited) {
	visited = visited || {};
	if(visited[name]) {
		return "";
	}
	visited[name] = true;
	var currentPalette = (wiki.getTiddlerText("$:/Palette") || "$:/palettes/Vanilla").trim();
	var val = wiki.extractTiddlerDataItem(currentPalette, name, "");
	if(!val) {
		var palTiddler = wiki.getTiddler(currentPalette);
		if(palTiddler && palTiddler.fields && palTiddler.fields.text) {
			var match = palTiddler.fields.text.match(new RegExp("^" + name + ":\\s*(.+)$", "m"));
			if(match) {
				val = match[1].trim();
			}
		}
	}
	if(!val) {
		val = wiki.extractTiddlerDataItem("$:/palettes/Vanilla", name, "");
	}
	if(!val) {
		val = wiki.getTiddlerText("$:/config/DefaultColourMappings/" + name, "");
	}
	val = (val || "").trim();
	var macroMatch = val.match(/^<<colou?r\s+([^\s>]+)>>$/i);
	if(macroMatch) {
		return getPaletteColor(wiki, macroMatch[1], visited);
	}
	return val;
}

// ---------------------------------------------------------------------------
// Mermaid Categorical & Branch Scale Generators
// ---------------------------------------------------------------------------

var CATEGORICAL_HUES = [215, 160, 260, 35, 195, 330, 95, 280, 15, 135, 45, 240];
var GIT_HUES = [255, 140, 205, 30, 320, 175, 45, 280];

function generateCategoricalScales(isDark, minContrast) {
	minContrast = minContrast || 4.5;
	var darkLabelHex = "#111113";
	var lightLabelHex = "#f8fafc";
	var darkLabelRgb = parseToRgb(darkLabelHex);
	var lightLabelRgb = parseToRgb(lightLabelHex);

	var scales = {};
	for(var i = 0; i < 12; i++) {
		var hue = CATEGORICAL_HUES[i];
		var sat = isDark ? 0.40 : 0.60;
		var light = isDark ? 0.22 : 0.90;

		var rgb = hslToRgb(hue, sat, light);
		var hex = rgbToHex(rgb[0], rgb[1], rgb[2]);

		var labelHex = isDark ? lightLabelHex : darkLabelHex;
		var labelRgb = isDark ? lightLabelRgb : darkLabelRgb;
		var cr = getContrastRatio(rgb, labelRgb);

		var attempts = 0;
		while(cr < minContrast && attempts < 10) {
			attempts++;
			if(isDark) {
				light = Math.max(0.06, light - 0.04);
			} else {
				light = Math.min(0.97, light + 0.03);
			}
			rgb = hslToRgb(hue, sat, light);
			hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
			cr = getContrastRatio(rgb, labelRgb);
		}

		scales["cScale" + i] = hex;
		scales["cScaleLabel" + i] = labelHex;
		scales["pie" + (i + 1)] = hex;
	}
	return scales;
}

function generateGitScales(isDark, minContrast) {
	minContrast = minContrast || 4.5;
	var darkLabelHex = "#111113";
	var lightLabelHex = "#ffffff";
	var darkLabelRgb = parseToRgb(darkLabelHex);
	var lightLabelRgb = parseToRgb(lightLabelHex);

	var scales = {};
	for(var i = 0; i < 8; i++) {
		var hue = GIT_HUES[i];
		var sat = isDark ? 0.75 : 0.70;
		var light = isDark ? 0.45 : 0.38;

		var rgb = hslToRgb(hue, sat, light);
		var hex = rgbToHex(rgb[0], rgb[1], rgb[2]);

		var crWhite = getContrastRatio(rgb, lightLabelRgb);
		var crBlack = getContrastRatio(rgb, darkLabelRgb);
		var labelHex = crWhite >= crBlack ? lightLabelHex : darkLabelHex;
		var chosenCr = Math.max(crWhite, crBlack);

		var attempts = 0;
		while(chosenCr < minContrast && attempts < 12) {
			attempts++;
			if(labelHex === lightLabelHex) {
				light = Math.max(0.08, light - 0.05);
			} else {
				light = Math.min(0.94, light + 0.05);
			}
			rgb = hslToRgb(hue, sat, light);
			hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
			crWhite = getContrastRatio(rgb, lightLabelRgb);
			crBlack = getContrastRatio(rgb, darkLabelRgb);
			labelHex = crWhite >= crBlack ? lightLabelHex : darkLabelHex;
			chosenCr = Math.max(crWhite, crBlack);
		}

		scales["git" + i] = hex;
		scales["gitBranchLabel" + i] = labelHex;
	}
	return scales;
}

// ---------------------------------------------------------------------------
// Widget Definition
// ---------------------------------------------------------------------------

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
	this.computeAttributes();
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
	var currentPalette = (this.wiki.getTiddlerText("$:/Palette") || "$:/palettes/Vanilla").trim();
	if(currentPalette) {
		var paletteTiddler = this.wiki.getTiddler(currentPalette);
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

MermaidWidget.prototype.buildPaletteThemeVariables = function(isDark) {
	var bgRaw = getPaletteColor(this.wiki, "tiddler-background") || getPaletteColor(this.wiki, "background");
	var bgRgb = parseToRgb(bgRaw) || (isDark ? [24, 24, 27, 1] : [255, 255, 255, 1]);
	var bgHex = rgbToHex(bgRgb[0], bgRgb[1], bgRgb[2]);

	var fgRaw = getPaletteColor(this.wiki, "foreground");
	var fgHex = colorToHex(fgRaw, bgRgb, isDark ? "#f4f4f5" : "#18181b");

	var primaryRaw = getPaletteColor(this.wiki, "primary");
	var primaryHex = colorToHex(primaryRaw, bgRgb, isDark ? "#a882ff" : "#5778d8");

	var mutedRaw = getPaletteColor(this.wiki, "muted-foreground");
	var mutedHex = colorToHex(mutedRaw, bgRgb, isDark ? "#a1a1aa" : "#64748b");

	var borderRaw = getPaletteColor(this.wiki, "table-border");
	var borderHex = colorToHex(borderRaw, bgRgb, isDark ? "#3f3f46" : "#e4e4e7");

	var codeBgRaw = getPaletteColor(this.wiki, "code-background");
	var codeBgHex = colorToHex(codeBgRaw, bgRgb, isDark ? "#27272a" : "#f4f4f5");

	var lineHex = isDark ? "#cbd5e1" : "#334155";
	var nodeBkg = isDark ? mixHex(bgHex, primaryHex, 0.15) : mixHex(bgHex, primaryHex, 0.08);
	var nodeBorder = primaryHex;
	var nodeTextColor = getBestTextColor(nodeBkg, "#ffffff", fgHex);

	var tv = {
		darkMode: isDark,
		background: bgHex,
		mainBkg: nodeBkg,
		primaryColor: primaryHex,
		primaryTextColor: fgHex,
		primaryBorderColor: nodeBorder,
		secondaryColor: codeBgHex,
		secondaryTextColor: fgHex,
		secondaryBorderColor: borderHex,
		tertiaryColor: mixHex(bgHex, fgHex, isDark ? 0.08 : 0.04),
		tertiaryTextColor: fgHex,
		tertiaryBorderColor: borderHex,
		nodeBkg: nodeBkg,
		nodeBorder: nodeBorder,
		nodeTextColor: nodeTextColor,
		textColor: fgHex,
		lineColor: lineHex,
		arrowheadColor: lineHex,
		border1: nodeBorder,
		border2: borderHex,
		titleColor: fgHex,
		edgeLabelBackground: codeBgHex,
		clusterBkg: mixHex(bgHex, fgHex, isDark ? 0.08 : 0.04),
		clusterBorder: borderHex,
		actorBkg: nodeBkg,
		actorBorder: nodeBorder,
		actorTextColor: fgHex,
		actorLineColor: lineHex,
		labelBoxBkgColor: nodeBkg,
		labelBoxBorderColor: nodeBorder,
		labelTextColor: fgHex,
		signalColor: fgHex,
		signalTextColor: fgHex,
		loopTextColor: fgHex,
		noteBkgColor: isDark ? "#2e2912" : "#fef9c3",
		noteTextColor: isDark ? "#fef08a" : "#713f12",
		noteBorderColor: "#ca8a04",
		activationBkgColor: codeBgHex,
		activationBorderColor: nodeBorder,
		sequenceNumberColor: "#ffffff",
		rectBkgColor: nodeBkg,
		rowOdd: bgHex,
		rowEven: codeBgHex,
		attributeBackgroundColorOdd: bgHex,
		attributeBackgroundColorEven: codeBgHex,
		commitLabelColor: fgHex,
		commitLabelBackground: codeBgHex,
		tagLabelColor: "#ffffff",
		tagLabelBackground: primaryHex,
		tagLabelBorder: primaryHex,
		taskBkgColor: primaryHex,
		taskBorderColor: nodeBorder,
		taskTextColor: "#ffffff",
		activeTaskBkgColor: mixHex(primaryHex, "#ffffff", 0.25),
		activeTaskBorderColor: primaryHex,
		doneTaskBkgColor: mutedHex,
		doneTaskBorderColor: borderHex
	};

	// Inject 12 WCAG AA guaranteed categorical scales
	var cScales = generateCategoricalScales(isDark, 4.5);
	$tw.utils.each(cScales, function(val, key) {
		tv[key] = val;
	});

	// Inject 8 GitGraph branch scales
	var gitScales = generateGitScales(isDark, 4.5);
	$tw.utils.each(gitScales, function(val, key) {
		tv[key] = val;
	});

	return tv;
};

MermaidWidget.prototype.buildHighContrastThemeVariables = function(isDark) {
	var bgHex = isDark ? "#000000" : "#ffffff";
	var fgHex = isDark ? "#ffffff" : "#000000";
	var borderHex = isDark ? "#ffffff" : "#000000";
	var subtleHex = isDark ? "#121212" : "#f5f5f5";

	var tv = {
		darkMode: isDark,
		background: bgHex,
		mainBkg: bgHex,
		primaryColor: borderHex,
		primaryTextColor: fgHex,
		primaryBorderColor: borderHex,
		secondaryColor: subtleHex,
		secondaryTextColor: fgHex,
		secondaryBorderColor: borderHex,
		tertiaryColor: subtleHex,
		tertiaryTextColor: fgHex,
		tertiaryBorderColor: borderHex,
		nodeBkg: bgHex,
		nodeBorder: borderHex,
		nodeTextColor: fgHex,
		textColor: fgHex,
		lineColor: borderHex,
		arrowheadColor: borderHex,
		border1: borderHex,
		border2: borderHex,
		strokeWidth: 2,
		titleColor: fgHex,
		edgeLabelBackground: bgHex,
		clusterBkg: subtleHex,
		clusterBorder: borderHex,
		actorBkg: bgHex,
		actorBorder: borderHex,
		actorTextColor: fgHex,
		actorLineColor: borderHex,
		labelBoxBkgColor: bgHex,
		labelBoxBorderColor: borderHex,
		labelTextColor: fgHex,
		signalColor: fgHex,
		signalTextColor: fgHex,
		loopTextColor: fgHex,
		noteBkgColor: isDark ? "#000000" : "#ffffff",
		noteTextColor: fgHex,
		noteBorderColor: borderHex,
		activationBkgColor: subtleHex,
		activationBorderColor: borderHex,
		sequenceNumberColor: isDark ? "#000000" : "#ffffff",
		rectBkgColor: bgHex,
		rowOdd: bgHex,
		rowEven: subtleHex,
		attributeBackgroundColorOdd: bgHex,
		attributeBackgroundColorEven: subtleHex,
		commitLabelColor: fgHex,
		commitLabelBackground: bgHex,
		tagLabelColor: isDark ? "#000000" : "#ffffff",
		tagLabelBackground: borderHex,
		tagLabelBorder: borderHex,
		taskBkgColor: borderHex,
		taskBorderColor: borderHex,
		taskTextColor: isDark ? "#000000" : "#ffffff",
		activeTaskBkgColor: borderHex,
		activeTaskBorderColor: borderHex,
		doneTaskBkgColor: subtleHex,
		doneTaskBorderColor: borderHex
	};

	// High contrast requires WCAG AAA (>= 7.0:1)
	var cScales = generateCategoricalScales(isDark, 7.0);
	$tw.utils.each(cScales, function(val, key) {
		tv[key] = val;
	});

	var gitScales = generateGitScales(isDark, 7.0);
	$tw.utils.each(gitScales, function(val, key) {
		tv[key] = val;
	});

	return tv;
};

MermaidWidget.prototype.buildTechnicalThemeVariables = function(isDark) {
	var bgHex = isDark ? "#0b1120" : "#f8fafc";
	var nodeBkg = isDark ? "#0f172a" : "#f1f5f9";
	var borderHex = isDark ? "#38bdf8" : "#2563eb";
	var fgHex = isDark ? "#f8fafc" : "#0f172a";
	var lineHex = isDark ? "#94a3b8" : "#334155";
	var subtleHex = isDark ? "#1e293b" : "#e2e8f0";

	var tv = {
		darkMode: isDark,
		background: bgHex,
		mainBkg: nodeBkg,
		primaryColor: borderHex,
		primaryTextColor: fgHex,
		primaryBorderColor: borderHex,
		secondaryColor: subtleHex,
		secondaryTextColor: fgHex,
		secondaryBorderColor: lineHex,
		tertiaryColor: subtleHex,
		tertiaryTextColor: fgHex,
		tertiaryBorderColor: lineHex,
		nodeBkg: nodeBkg,
		nodeBorder: borderHex,
		nodeTextColor: fgHex,
		textColor: fgHex,
		lineColor: lineHex,
		arrowheadColor: lineHex,
		border1: borderHex,
		border2: lineHex,
		titleColor: fgHex,
		edgeLabelBackground: subtleHex,
		clusterBkg: subtleHex,
		clusterBorder: lineHex,
		actorBkg: nodeBkg,
		actorBorder: borderHex,
		actorTextColor: fgHex,
		actorLineColor: lineHex,
		labelBoxBkgColor: nodeBkg,
		labelBoxBorderColor: borderHex,
		labelTextColor: fgHex,
		signalColor: fgHex,
		signalTextColor: fgHex,
		loopTextColor: fgHex,
		noteBkgColor: isDark ? "#172554" : "#eff6ff",
		noteTextColor: isDark ? "#93c5fd" : "#1e40af",
		noteBorderColor: borderHex,
		activationBkgColor: subtleHex,
		activationBorderColor: borderHex,
		sequenceNumberColor: "#ffffff",
		rectBkgColor: nodeBkg,
		rowOdd: nodeBkg,
		rowEven: subtleHex,
		attributeBackgroundColorOdd: nodeBkg,
		attributeBackgroundColorEven: subtleHex,
		commitLabelColor: fgHex,
		commitLabelBackground: subtleHex,
		tagLabelColor: "#ffffff",
		tagLabelBackground: borderHex,
		tagLabelBorder: borderHex,
		taskBkgColor: borderHex,
		taskBorderColor: borderHex,
		taskTextColor: "#ffffff",
		activeTaskBkgColor: mixHex(borderHex, "#ffffff", 0.2),
		activeTaskBorderColor: borderHex,
		doneTaskBkgColor: subtleHex,
		doneTaskBorderColor: lineHex
	};

	var cScales = generateCategoricalScales(isDark, 4.5);
	$tw.utils.each(cScales, function(val, key) {
		tv[key] = val;
	});

	var gitScales = generateGitScales(isDark, 4.5);
	$tw.utils.each(gitScales, function(val, key) {
		tv[key] = val;
	});

	return tv;
};

MermaidWidget.prototype.buildMonochromeThemeVariables = function(isDark) {
	var bgHex = isDark ? "#121212" : "#ffffff";
	var nodeBkg = isDark ? "#1e1e1e" : "#f5f5f5";
	var borderHex = isDark ? "#d4d4d4" : "#171717";
	var fgHex = isDark ? "#fafafa" : "#0a0a0a";
	var lineHex = isDark ? "#a3a3a3" : "#404040";
	var subtleHex = isDark ? "#262626" : "#e5e5e5";

	var tv = {
		darkMode: isDark,
		background: bgHex,
		mainBkg: nodeBkg,
		primaryColor: borderHex,
		primaryTextColor: fgHex,
		primaryBorderColor: borderHex,
		secondaryColor: subtleHex,
		secondaryTextColor: fgHex,
		secondaryBorderColor: lineHex,
		tertiaryColor: subtleHex,
		tertiaryTextColor: fgHex,
		tertiaryBorderColor: lineHex,
		nodeBkg: nodeBkg,
		nodeBorder: borderHex,
		nodeTextColor: fgHex,
		textColor: fgHex,
		lineColor: lineHex,
		arrowheadColor: lineHex,
		border1: borderHex,
		border2: lineHex,
		titleColor: fgHex,
		edgeLabelBackground: subtleHex,
		clusterBkg: subtleHex,
		clusterBorder: lineHex,
		actorBkg: nodeBkg,
		actorBorder: borderHex,
		actorTextColor: fgHex,
		actorLineColor: lineHex,
		labelBoxBkgColor: nodeBkg,
		labelBoxBorderColor: borderHex,
		labelTextColor: fgHex,
		signalColor: fgHex,
		signalTextColor: fgHex,
		loopTextColor: fgHex,
		noteBkgColor: isDark ? "#262626" : "#f5f5f5",
		noteTextColor: fgHex,
		noteBorderColor: lineHex,
		activationBkgColor: subtleHex,
		activationBorderColor: borderHex,
		sequenceNumberColor: isDark ? "#000000" : "#ffffff",
		rectBkgColor: nodeBkg,
		rowOdd: nodeBkg,
		rowEven: subtleHex,
		attributeBackgroundColorOdd: nodeBkg,
		attributeBackgroundColorEven: subtleHex,
		commitLabelColor: fgHex,
		commitLabelBackground: subtleHex,
		tagLabelColor: isDark ? "#000000" : "#ffffff",
		tagLabelBackground: borderHex,
		tagLabelBorder: borderHex,
		taskBkgColor: borderHex,
		taskBorderColor: borderHex,
		taskTextColor: isDark ? "#000000" : "#ffffff",
		activeTaskBkgColor: lineHex,
		activeTaskBorderColor: borderHex,
		doneTaskBkgColor: subtleHex,
		doneTaskBorderColor: lineHex
	};

	// Grayscale categorical steps
	var darkLabelHex = "#111113";
	var lightLabelHex = "#ffffff";
	var grayLights = isDark
		? [0.15, 0.22, 0.28, 0.35, 0.18, 0.25, 0.30, 0.16, 0.24, 0.32, 0.20, 0.27]
		: [0.94, 0.88, 0.82, 0.76, 0.91, 0.85, 0.79, 0.93, 0.87, 0.81, 0.89, 0.83];

	for(var i = 0; i < 12; i++) {
		var l = grayLights[i];
		var rgb = hslToRgb(0, 0, l);
		var hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
		var label = getBestTextColor(hex, lightLabelHex, darkLabelHex);
		tv["cScale" + i] = hex;
		tv["cScaleLabel" + i] = label;
		tv["pie" + (i + 1)] = hex;
	}

	for(var j = 0; j < 8; j++) {
		var gl = isDark ? (0.18 + j * 0.03) : (0.82 - j * 0.03);
		var grgb = hslToRgb(0, 0, gl);
		var ghex = rgbToHex(grgb[0], grgb[1], grgb[2]);
		var glabel = getBestTextColor(ghex, lightLabelHex, darkLabelHex);
		var attempts = 0;
		while(getContrastRatio(grgb, parseToRgb(glabel)) < 4.5 && attempts < 10) {
			attempts++;
			if(glabel === lightLabelHex) {
				gl = Math.max(0.05, gl - 0.04);
			} else {
				gl = Math.min(0.95, gl + 0.04);
			}
			grgb = hslToRgb(0, 0, gl);
			ghex = rgbToHex(grgb[0], grgb[1], grgb[2]);
			glabel = getBestTextColor(ghex, lightLabelHex, darkLabelHex);
		}
		tv["git" + j] = ghex;
		tv["gitBranchLabel" + j] = glabel;
	}

	return tv;
};

MermaidWidget.prototype.resolveThemeConfig = function() {
	var requestedTheme = this.themeAttr;
	if(!requestedTheme || requestedTheme === "auto") {
		var configTheme = this.wiki.getTiddlerText("$:/config/mblackman/mermaid/theme", "auto").trim();
		if(configTheme) {
			requestedTheme = configTheme;
		}
	}

	var isDark = this.isDarkMode();

	// Default & palette theme: Dynamic active TiddlyWiki palette
	if(!requestedTheme || requestedTheme === "auto" || requestedTheme === "palette") {
		return {
			theme: "base",
			themeVariables: this.buildPaletteThemeVariables(isDark)
		};
	}

	// High Contrast theme (Auto or explicit light/dark)
	if(requestedTheme === "high-contrast") {
		return {
			theme: "base",
			themeVariables: this.buildHighContrastThemeVariables(isDark)
		};
	}
	if(requestedTheme === "high-contrast-light") {
		return {
			theme: "base",
			themeVariables: this.buildHighContrastThemeVariables(false)
		};
	}
	if(requestedTheme === "high-contrast-dark") {
		return {
			theme: "base",
			themeVariables: this.buildHighContrastThemeVariables(true)
		};
	}

	// Technical / Blueprint theme
	if(requestedTheme === "technical" || requestedTheme === "blueprint") {
		return {
			theme: "base",
			themeVariables: this.buildTechnicalThemeVariables(isDark)
		};
	}
	if(requestedTheme === "technical-light" || requestedTheme === "blueprint-light") {
		return {
			theme: "base",
			themeVariables: this.buildTechnicalThemeVariables(false)
		};
	}
	if(requestedTheme === "technical-dark" || requestedTheme === "blueprint-dark") {
		return {
			theme: "base",
			themeVariables: this.buildTechnicalThemeVariables(true)
		};
	}

	// Monochrome theme
	if(requestedTheme === "monochrome") {
		return {
			theme: "base",
			themeVariables: this.buildMonochromeThemeVariables(isDark)
		};
	}
	if(requestedTheme === "monochrome-light") {
		return {
			theme: "base",
			themeVariables: this.buildMonochromeThemeVariables(false)
		};
	}
	if(requestedTheme === "monochrome-dark") {
		return {
			theme: "base",
			themeVariables: this.buildMonochromeThemeVariables(true)
		};
	}

	// Modern Mermaid v11 themes with auto-switching
	if(requestedTheme === "redux-auto") {
		return { theme: isDark ? "redux-dark" : "redux" };
	}
	if(requestedTheme === "redux-color-auto") {
		return { theme: isDark ? "redux-dark-color" : "redux-color" };
	}
	if(requestedTheme === "neo-auto") {
		return { theme: isDark ? "neo-dark" : "neo" };
	}

	// Classic Mermaid themes or direct stock theme names
	var stockThemes = [
		"default", "dark", "forest", "neutral", "base",
		"redux", "redux-dark", "redux-color", "redux-dark-color",
		"neo", "neo-dark"
	];
	if(stockThemes.indexOf(requestedTheme) !== -1) {
		return { theme: requestedTheme };
	}

	// Fallback to palette theme
	return {
		theme: "base",
		themeVariables: this.buildPaletteThemeVariables(isDark)
	};
};

// Backwards compatibility for anything querying resolveTheme() directly
MermaidWidget.prototype.resolveTheme = function() {
	var cfg = this.resolveThemeConfig();
	return cfg.theme;
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
	var themeConfig = this.resolveThemeConfig();
	var effectiveSecurity = this.securityLevel || this.wiki.getTiddlerText("$:/config/mblackman/mermaid/securityLevel", "loose").trim();
	var id = "mermaid-svg-" + (++diagramCounter);

	queueRender(function() {
		if(self.renderGeneration !== currentGen) {
			return Promise.resolve();
		}
		try {
			var initOptions = {
				startOnLoad: false,
				theme: themeConfig.theme,
				securityLevel: effectiveSecurity
			};
			if(themeConfig.themeVariables) {
				initOptions.themeVariables = themeConfig.themeVariables;
			}
			mermaidApi.initialize(initOptions);
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
	var currentPalette = (this.wiki.getTiddlerText("$:/Palette") || "$:/palettes/Vanilla").trim();
	var changedAttributes = this.computeAttributes();
	if(
		changedAttributes.text ||
		changedAttributes.source ||
		changedAttributes.theme ||
		changedAttributes.align ||
		changedAttributes["class"] ||
		changedAttributes["security-level"] ||
		changedTiddlers["$:/Palette"] ||
		changedTiddlers[currentPalette] ||
		changedTiddlers["$:/config/mblackman/mermaid/theme"] ||
		changedTiddlers["$:/config/mblackman/mermaid/securityLevel"] ||
		changedTiddlers["$:/config/mblackman/mermaid/security-level"]
	) {
		this.refreshSelf();
		return true;
	}
	return false;
};

exports.mermaid = MermaidWidget;

})();

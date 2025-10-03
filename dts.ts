type DtsReference = { ref: string };
type DtsByteArray = { bytes: number[] };

type DtsScalar = boolean | number | string | DtsReference | DtsByteArray;
export type DtsValue =
	| DtsScalar
	| Array<DtsScalar | Array<number | string | DtsReference>>;

export type DtsPropertyType =
	| "boolean"
	| "string"
	| "string-list"
	| "number"
	| "cell-list"
	| "byte-list"
	| "reference"
	| "mixed";

export interface DtsProperty {
	name: string;
	value: DtsValue;
	raw: string;
	type: DtsPropertyType;
}

export interface DtsNode {
	name: string;
	label?: string;
	unitAddress?: string;
	fullName: string;
	path: string;
	properties: DtsProperty[];
	children: DtsNode[];
}

export interface DtsParseResult {
	root: DtsNode;
	errors: string[];
	warnings: string[];
}

interface ParseContext {
	current: string;
	inString: boolean;
	angleDepth: number;
	bracketDepth: number;
	statements: string[];
	lastStatement: string;
}

const ROOT_NODE: DtsNode = {
	name: "<root>",
	fullName: "/",
	path: "/",
	properties: [],
	children: [],
};

/**
 * Parse Device Tree Source (DTS) text into a structured representation
 * that can be consumed by the viewer.
 *
 * @param payload Raw DTS file contents.
 * @returns Tree rooted at `/` along with parse diagnostics.
 */
export const dtsPare = (payload: string | null | undefined): DtsParseResult => {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (typeof payload !== "string") {
		return {
			root: { ...ROOT_NODE, children: [], properties: [] },
			errors: ["Expected DTS payload to be a string"],
			warnings,
		};
	}

	const sanitized = stripComments(payload);
	const statements = tokenizeStatements(sanitized);

	const root: DtsNode = {
		name: "<root>",
		fullName: "/",
		path: "/",
		properties: [],
		children: [],
	};

	const stack: DtsNode[] = [root];

	statements.forEach((statement, index) => {
		if (!statement) {
			return;
		}

		if (statement.startsWith("#")) {
			warnings.push(`Preprocessor directive ignored: ${statement}`);
			return;
		}

		if (statement.endsWith("{")) {
			const node = parseNodeHeader(statement, errors, index + 1);
			if (!node) {
				return;
			}

			const parent = stack[stack.length - 1]!;
			const fullName = node.unitAddress
				? `${node.name}@${node.unitAddress}`
				: node.name;
			const path = buildPath(parent.path, fullName);

			const nextNode: DtsNode = {
				...node,
				fullName,
				path,
				properties: [],
				children: [],
			};

			parent.children.push(nextNode);
			stack.push(nextNode);
			return;
		}

		if (statement === "}") {
			if (stack.length === 1) {
				errors.push("Encountered closing brace without matching node");
				return;
			}
			stack.pop();
			return;
		}

		const property = parseProperty(statement, errors, warnings, index + 1);
		if (!property) {
			return;
		}

		const currentNode = stack[stack.length - 1]!;
		currentNode.properties.push(property);
	});

	if (stack.length > 1) {
		errors.push("Unclosed node(s) detected at end of file");
	}

	const rootChild = root.children[0];
	const rootNode =
		root.children.length === 1 && rootChild?.fullName === "/"
			? rootChild
			: root;

	return {
		root: rootNode,
		errors,
		warnings,
	};
};

const stripComments = (input: string): string => {
	const withoutBlock = input.replace(/\/\*[\s\S]*?\*\//g, "");
	return withoutBlock
		.split(/\r?\n/)
		.map((line) => line.replace(/\/\/.*$/, ""))
		.join("\n");
};

const tokenizeStatements = (input: string): string[] => {
	const ctx: ParseContext = {
		current: "",
		inString: false,
		angleDepth: 0,
		bracketDepth: 0,
		statements: [],
		lastStatement: "",
	};

	const pushCurrent = () => {
		const trimmed = ctx.current.trim();
		if (trimmed) {
			ctx.statements.push(trimmed);
			ctx.lastStatement = trimmed;
		}
		ctx.current = "";
	};

	for (let i = 0; i < input.length; i += 1) {
		const char = input[i];
		const prev = input[i - 1];

		if (ctx.inString) {
			ctx.current += char;
			if (char === '"' && prev !== "\\") {
				ctx.inString = false;
			}
			continue;
		}

		if (char === '"') {
			ctx.inString = true;
			ctx.current += char;
			continue;
		}

		if (char === "<") {
			ctx.angleDepth += 1;
			ctx.current += char;
			continue;
		}

		if (char === ">") {
			ctx.angleDepth = Math.max(0, ctx.angleDepth - 1);
			ctx.current += char;
			continue;
		}

		if (char === "[") {
			ctx.bracketDepth += 1;
			ctx.current += char;
			continue;
		}

		if (char === "]") {
			ctx.bracketDepth = Math.max(0, ctx.bracketDepth - 1);
			ctx.current += char;
			continue;
		}

		if (char === "{") {
			ctx.current += char;
			pushCurrent();
			continue;
		}

		if (char === "}") {
			if (ctx.current.trim()) {
				pushCurrent();
			} else {
				ctx.current = "";
			}
			ctx.statements.push("}");
			ctx.lastStatement = "}";
			continue;
		}

		if (char === ";" && ctx.angleDepth === 0 && ctx.bracketDepth === 0) {
			ctx.current += char;
			const trimmed = ctx.current.trim();
			if (!(trimmed === ";" && ctx.lastStatement === "}")) {
				pushCurrent();
			}
			ctx.current = "";
			continue;
		}

		if (char === "\n" || char === "\r") {
			ctx.current += " ";
			continue;
		}

		ctx.current += char;
	}

	if (ctx.current.trim()) {
		ctx.statements.push(ctx.current.trim());
	}

	return ctx.statements.filter(Boolean);
};

const parseNodeHeader = (
	statement: string,
	errors: string[],
	lineNumber: number,
): Pick<DtsNode, "name" | "label" | "unitAddress"> | null => {
	const header = statement.replace(/\{$/, "").trim();
	const match = header.match(
		/^((?<label>[A-Za-z_][\w.-]*)\s*:\s*)?(?<name>\/|[A-Za-z0-9,._+\-]+)(?:@(?<unit>[A-Za-z0-9,._+\-]+))?$/,
	);

	if (!match || !match.groups) {
		errors.push(
			`Malformed node declaration at statement ${lineNumber}: ${statement}`,
		);
		return null;
	}

	return {
		name: normalizeNodeName(match.groups, errors, statement, lineNumber),
		label: match.groups.label?.trim(),
		unitAddress: match.groups.unit,
	};
};

const normalizeNodeName = (
	groups: {
		label?: string;
		name?: string;
		unit?: string;
	},
	errors: string[],
	statement: string,
	lineNumber: number,
): string => {
	const rawName = groups.name?.trim();
	if (!rawName) {
		errors.push(
			`Missing node name at statement ${lineNumber}: ${statement}`,
		);
		return "<unknown>";
	}
	return rawName;
};

const parseProperty = (
	statement: string,
	errors: string[],
	warnings: string[],
	lineNumber: number,
): DtsProperty | null => {
	const trimmed = statement.replace(/;$/, "").trim();

	if (!trimmed.includes("=")) {
		return {
			name: trimmed,
			value: true,
			raw: statement,
			type: "boolean",
		};
	}

	const eqIndex = trimmed.indexOf("=");
	if (eqIndex === -1) {
		errors.push(
			`Malformed property at statement ${lineNumber}: ${statement}`,
		);
		return null;
	}
	const name = trimmed.slice(0, eqIndex).trim();
	const valueText = trimmed.slice(eqIndex + 1).trim();

	const value = parseValue(valueText, warnings, lineNumber);

	if (value === undefined) {
		errors.push(
			`Unable to parse value at statement ${lineNumber}: ${statement}`,
		);
		return null;
	}

	return {
		name,
		value: value.value,
		raw: statement,
		type: value.type,
	};
};

interface ParsedValue {
	value: DtsValue;
	type: DtsPropertyType;
}

const parseValue = (
	valueText: string,
	warnings: string[],
	lineNumber: number,
): ParsedValue | undefined => {
	if (!valueText) {
		return {
			value: true,
			type: "boolean",
		};
	}

	if (valueText.startsWith('"')) {
		const strings = extractStringList(valueText);
		if (!strings.length) {
			return {
				value: unescapeString(valueText.replace(/^"|"$/g, "")),
				type: "string",
			};
		}

		if (strings.length === 1) {
			const single = strings[0]!;
			return {
				value: single,
				type: "string",
			};
		}

		return {
			value: strings,
			type: "string-list",
		};
	}

	if (valueText.startsWith("<")) {
		const groups = Array.from(valueText.matchAll(/<([^>]*)>/g))
			.map((match) => match[1])
			.filter((group): group is string => typeof group === "string");
		if (!groups.length) {
			warnings.push(`Empty cell list at statement ${lineNumber}`);
			return {
				value: [],
				type: "cell-list",
			};
		}

		const parsedGroups = groups.map((group) =>
			group
				.split(/[\s,]+/)
				.filter(Boolean)
				.map(parseCellToken),
		);

		if (parsedGroups.length === 1) {
			const singleGroup = parsedGroups[0]!;
			return {
				value: singleGroup,
				type: "cell-list",
			};
		}

		return {
			value: parsedGroups,
			type: "cell-list",
		};
	}

	if (valueText.startsWith("[")) {
		const inner = valueText.replace(/^[[]|[]]$/g, "");
		const bytes = inner
			.split(/[\s,]+/)
			.filter(Boolean)
			.map((token) => parseInt(token, 16))
			.filter((byte) => !Number.isNaN(byte));

		return {
			value: { bytes },
			type: "byte-list",
		};
	}

	if (/^&[A-Za-z_][\w.-]*$/.test(valueText)) {
		return {
			value: { ref: valueText.slice(1) },
			type: "reference",
		};
	}

	if (/^0x[0-9a-fA-F]+$/.test(valueText)) {
		return {
			value: parseInt(valueText, 16),
			type: "number",
		};
	}

	if (/^-?\d+$/.test(valueText)) {
		return {
			value: parseInt(valueText, 10),
			type: "number",
		};
	}

	if (valueText.includes(",")) {
		const potentialStrings = extractStringList(valueText);
		if (potentialStrings.length) {
			return {
				value: potentialStrings,
				type: "string-list",
			};
		}
	}

	return {
		value: valueText,
		type: "mixed",
	};
};

const extractStringList = (valueText: string): string[] => {
	const strings: string[] = [];
	let current = "";
	let inString = false;
	let escaping = false;

	for (let i = 0; i < valueText.length; i += 1) {
		const char = valueText[i];

		if (!inString) {
			if (char === '"') {
				inString = true;
				current = "";
			}
			continue;
		}

		if (escaping) {
			switch (char) {
				case "n":
					current += "\n";
					break;
				case "r":
					current += "\r";
					break;
				case "t":
					current += "\t";
					break;
				case '"':
					current += '"';
					break;
				case "\\":
					current += "\\";
					break;
				default:
					current += char;
					break;
			}
			escaping = false;
			continue;
		}

		if (char === "\\") {
			escaping = true;
			continue;
		}

		if (char === '"') {
			strings.push(current);
			inString = false;
			current = "";
			continue;
		}

		current += char;
	}

	return strings;
};

const parseCellToken = (token: string): number | string | DtsReference => {
	if (!token) {
		return token;
	}

	if (token.startsWith("&")) {
		return { ref: token.slice(1) };
	}

	if (/^0x[0-9a-fA-F]+$/.test(token)) {
		return parseInt(token, 16);
	}

	if (/^-?\d+$/.test(token)) {
		return parseInt(token, 10);
	}

	return token;
};

const unescapeString = (value: string): string =>
	value.replace(/\\([nrt"\\])/g, (_match, captured) => {
		switch (captured) {
			case "n":
				return "\n";
			case "r":
				return "\r";
			case "t":
				return "\t";
			case '"':
				return '"';
			case "\\":
				return "\\";
			default:
				return captured;
		}
	});

const buildPath = (parentPath: string, fullName: string): string => {
	if (fullName === "/") {
		return "/";
	}

	if (parentPath === "/") {
		return fullName.startsWith("/") ? fullName : `/${fullName}`;
	}

	return `${parentPath}/${fullName}`;
};

import type { DtsNode, DtsValue } from "./dts";

const REGISTER_COLOR_PALETTE = [
    "#2563eb",
    "#16a34a",
    "#d97706",
    "#dc2626",
    "#7c3aed",
    "#0891b2",
    "#f97316",
    "#0f766e",
    "#a855f7",
    "#9333ea",
];

const DEFAULT_CELL_SPEC = {
    addressCells: 1,
    sizeCells: 1,
};

type CellSpec = {
    addressCells: number;
    sizeCells: number;
};

type RegisterRange = {
    node: DtsNode;
    base: bigint;
    size: bigint;
    end: bigint;
};

type RegisterMapElements = {
    panel: HTMLElement | null;
    toggle: HTMLButtonElement | null;
    status: HTMLParagraphElement | null;
    track: HTMLDivElement | null;
    legend: HTMLDivElement | null;
    axis: HTMLDivElement | null;
};

type RegisterMapOptions = RegisterMapElements & {
    onFocusNode: (path: string) => void;
    collectNumbersFromValue: (value: DtsValue) => number[];
};

export type RegisterMapController = {
    setExpanded: (expanded: boolean) => void;
    isExpanded: () => boolean;
    updateRanges: (root: DtsNode | null) => void;
    setSelection: (path: string | null) => void;
};

const formatBigIntHex = (value: bigint): string => `0x${value.toString(16)}`;

const formatByteSize = (value: bigint): string => {
    if (value <= 0n) {
        return "0 bytes";
    }
    const hex = formatBigIntHex(value);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        return hex;
    }
    const units = ["bytes", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let size = Number(value);
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    const formatted = size >= 10 ? size.toFixed(0) : size.toFixed(1);
    return `${hex} (${formatted} ${units[unitIndex]!})`;
};

const combineCellsToBigInt = (cells: number[]): bigint => {
    if (!cells.length) {
        return 0n;
    }
    return cells.reduce((acc, cell) => {
        const truncated = Math.trunc(cell);
        const normalized = BigInt.asUintN(32, BigInt(truncated));
        return (acc << 32n) + normalized;
    }, 0n);
};

const normalizeRegValue = (
    value: DtsValue,
    collectNumbersFromValue: (value: DtsValue) => number[],
): number[][] => {
    const groups: number[][] = [];
    const pushGroup = (candidate: unknown) => {
        const numbers = collectNumbersFromValue(candidate as DtsValue);
        if (numbers.length) {
            groups.push(numbers);
        }
    };

    if (Array.isArray(value)) {
        if (value.length && Array.isArray(value[0])) {
            value.forEach((group) => pushGroup(group));
            return groups;
        }
        pushGroup(value);
        return groups;
    }

    pushGroup(value);
    return groups;
};

const getNumericPropertyValue = (
    node: DtsNode,
    name: string,
    collectNumbersFromValue: (value: DtsValue) => number[],
): number | null => {
    const property = node.properties.find((prop) => prop.name === name);
    if (!property) {
        return null;
    }
    const numbers = collectNumbersFromValue(property.value);
    if (!numbers.length) {
        return null;
    }
    return numbers[0] ?? null;
};

export const createRegisterMap = (
    options: RegisterMapOptions,
): RegisterMapController => {
    const { panel, toggle, status, track, legend, axis, onFocusNode, collectNumbersFromValue } =
        options;

    let registerRanges: RegisterRange[] = [];
    const registerColorByPath = new Map<string, string>();
    let expanded = false;
    let hasRoot = false;
    let selection: string | null = null;

    const applyExpansion = () => {
        panel?.classList.toggle("collapsed", !expanded);
        if (toggle) {
            toggle.textContent = expanded ? "Hide register map" : "Show register map";
            toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        }
    };

    const getRegisterColor = (path: string): string => {
        let color = registerColorByPath.get(path);
        if (!color) {
            color =
                REGISTER_COLOR_PALETTE[registerColorByPath.size % REGISTER_COLOR_PALETTE.length] ??
                "#1d4ed8";
            registerColorByPath.set(path, color);
        }
        return color;
    };

    const render = () => {
        if (!track || !legend || !status || !axis) {
            return;
        }

        track.innerHTML = "";
        legend.innerHTML = "";
        axis.innerHTML = "";

        const hasRanges = registerRanges.length > 0;
        track.classList.toggle("hidden", !hasRanges);
        legend.classList.toggle("hidden", !hasRanges);
        axis.classList.toggle("hidden", !hasRanges);

        if (toggle) {
            toggle.disabled = !hasRanges;
        }

        if (!hasRanges) {
            expanded = false;
            applyExpansion();
            status.textContent = hasRoot
                ? "No register ranges detected in this tree."
                : "Load a DTS file to view its register map.";
            return;
        }

        applyExpansion();

        const minBase = registerRanges.reduce(
            (min, range) => (range.base < min ? range.base : min),
            registerRanges[0]!.base,
        );
        const maxEnd = registerRanges.reduce(
            (max, range) => (range.end > max ? range.end : max),
            registerRanges[0]!.end,
        );
        const span = maxEnd > minBase ? maxEnd - minBase : 0n;
        const totalSpan = span > 0n ? span : 1n;
        const percentScale = 10000n;

        const regionLabel =
            registerRanges.length === 1
                ? "1 register region"
                : `${registerRanges.length} register regions`;
        const spanText = span > 0n ? formatByteSize(span) : "0 bytes";
        status.textContent = `${regionLabel}. Address span ${formatBigIntHex(minBase)} – ${formatBigIntHex(
            maxEnd,
        )} (${spanText}).`;

        const axisStart = document.createElement("span");
        axisStart.textContent = formatBigIntHex(minBase);
        const axisEnd = document.createElement("span");
        axisEnd.textContent = formatBigIntHex(maxEnd);
        axis.append(axisStart, axisEnd);

        let cursor = minBase;
        registerRanges.forEach((range) => {
            if (range.base > cursor) {
                const gap = range.base - cursor;
                const gapUnits = Number((gap * percentScale) / totalSpan);
                if (gapUnits > 0) {
                    const gapPercent = gapUnits / 100;
                    const gapElement = document.createElement("div");
                    gapElement.className = "register-gap";
                    gapElement.style.flex = `0 0 ${gapPercent}%`;
                    track.append(gapElement);
                }
            }

            const layoutSize = range.size > 0n ? range.size : 0n;
            const widthUnits = layoutSize > 0n ? Number((layoutSize * percentScale) / totalSpan) : 0;
            const widthPercent = layoutSize > 0n ? widthUnits / 100 : 0;
            const segment = document.createElement("button");
            segment.type = "button";
            segment.className = "register-segment";
            if (selection === range.node.path) {
                segment.classList.add("selected");
            }
            const color = getRegisterColor(range.node.path);
            segment.style.backgroundColor = color;
            segment.style.minWidth = "6px";
            if (layoutSize > 0n) {
                segment.style.flex = `0 0 ${widthPercent}%`;
            } else {
                segment.style.flex = "0 0 auto";
                segment.style.width = "6px";
            }
            const label = range.node.label
                ? `${range.node.label}: ${range.node.fullName}`
                : range.node.fullName;
            const end = range.size > 0n ? range.end : range.base;
            const sizeText = formatByteSize(range.size);
            segment.title =
                range.size > 0n
                    ? `${label} — ${formatBigIntHex(range.base)} to ${formatBigIntHex(end)} (${sizeText})`
                    : `${label} — ${formatBigIntHex(range.base)} (size: 0)`;
            segment.addEventListener("click", () => {
                onFocusNode(range.node.path);
            });
            track.append(segment);

            if (range.end > cursor) {
                cursor = range.end;
            }
        });

        const legendTable = document.createElement("table");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        ["", "Node", "Start", "End", "Size"].forEach((heading) => {
            const th = document.createElement("th");
            th.textContent = heading;
            headerRow.append(th);
        });
        thead.append(headerRow);
        legendTable.append(thead);

        const tbody = document.createElement("tbody");
        registerRanges.forEach((range) => {
            const row = document.createElement("tr");
            if (selection === range.node.path) {
                row.classList.add("selected");
            }

            const swatchCell = document.createElement("td");
            const swatch = document.createElement("span");
            swatch.className = "register-swatch";
            swatch.style.backgroundColor = getRegisterColor(range.node.path);
            swatchCell.append(swatch);

            const nodeCell = document.createElement("td");
            const nodeButton = document.createElement("button");
            nodeButton.type = "button";
            nodeButton.className = "register-link";
            nodeButton.textContent = range.node.label
                ? `${range.node.label}: ${range.node.fullName}`
                : range.node.fullName;
            nodeButton.addEventListener("click", () => {
                onFocusNode(range.node.path);
            });
            nodeCell.append(nodeButton);

            const startCell = document.createElement("td");
            startCell.textContent = formatBigIntHex(range.base);

            const endCell = document.createElement("td");
            endCell.textContent = formatBigIntHex(range.size > 0n ? range.end : range.base);

            const sizeCell = document.createElement("td");
            sizeCell.textContent = formatByteSize(range.size);

            row.append(swatchCell, nodeCell, startCell, endCell, sizeCell);
            tbody.append(row);
        });

        legendTable.append(tbody);
        legend.append(legendTable);
    };

    const updateRanges = (root: DtsNode | null) => {
        registerRanges = [];
        registerColorByPath.clear();
        hasRoot = Boolean(root);
        if (!root) {
            render();
            return;
        }

        const ranges: RegisterRange[] = [];
        const visit = (node: DtsNode, parentSpec: CellSpec) => {
            const regProperty = node.properties.find((prop) => prop.name === "reg");
            if (regProperty) {
                const groups = normalizeRegValue(regProperty.value, collectNumbersFromValue);
                const addressCells = Math.max(0, parentSpec.addressCells);
                const sizeCells = Math.max(0, parentSpec.sizeCells);
                const chunkSize = addressCells + sizeCells;
                if (chunkSize > 0) {
                    groups.forEach((group) => {
                        if (group.length < chunkSize) {
                            return;
                        }
                        for (let offset = 0; offset + chunkSize <= group.length; offset += chunkSize) {
                            const addressSlice = group.slice(offset, offset + addressCells);
                            const sizeSlice = group.slice(offset + addressCells, offset + chunkSize);
                            const base = combineCellsToBigInt(addressSlice);
                            const size = sizeCells > 0 ? combineCellsToBigInt(sizeSlice) : 0n;
                            const end = size > 0n ? base + size : base;
                            ranges.push({ node, base, size, end });
                        }
                    });
                }
            }

            const nextSpec: CellSpec = {
                addressCells:
                    getNumericPropertyValue(node, "#address-cells", collectNumbersFromValue) ??
                    parentSpec.addressCells,
                sizeCells:
                    getNumericPropertyValue(node, "#size-cells", collectNumbersFromValue) ??
                    parentSpec.sizeCells,
            };

            node.children.forEach((child) => visit(child, nextSpec));
        };

        visit(root, DEFAULT_CELL_SPEC);

        ranges.sort((a, b) => {
            if (a.base === b.base) {
                if (a.size === b.size) {
                    return a.node.path.localeCompare(b.node.path);
                }
                return a.size < b.size ? -1 : 1;
            }
            return a.base < b.base ? -1 : 1;
        });

        registerRanges = ranges;
        render();
    };

    const setExpanded = (value: boolean) => {
        expanded = value;
        applyExpansion();
    };

    const setSelection = (path: string | null) => {
        selection = path;
        render();
    };

    toggle?.addEventListener("click", () => {
        setExpanded(!expanded);
    });

    applyExpansion();
    render();

    return {
        setExpanded,
        isExpanded: () => expanded,
        updateRanges,
        setSelection,
    };
};


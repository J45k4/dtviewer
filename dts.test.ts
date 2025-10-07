import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dtsPare } from "./dts";
import type { DtsNode, DtsProperty } from "./dts";

const findNode = (root: DtsNode, path: string): DtsNode | undefined => {
        if (root.path === path) {
                return root;
        }
        for (const child of root.children) {
		const found = findNode(child, path);
		if (found) {
			return found;
		}
	}
	return undefined;
};

const getProperty = (node: DtsNode, name: string): DtsProperty | undefined =>
        node.properties.find((prop) => prop.name === name);

const findProperty = (node: DtsNode, name: string): DtsProperty | undefined => {
        const direct = node.properties.find((prop) => prop.name === name);
        if (direct) {
                return direct;
        }
        for (const child of node.children) {
                const found = findProperty(child, name);
                if (found) {
                        return found;
                }
        }
        return undefined;
};

describe("dtsPare", () => {
	test("parses nested device tree node with mixed property types", () => {
		const sample = `
/** Platform root **/
/ {
    model = "My Custom Board";
    chosen {
        bootargs = "console=ttyS0,115200";
    };

    usb@32f10108 {
        compatible = "fsl,imx8mp-dwc3";
        phandle = <0x83>;
        clocks = <0x2 0x10c 0x2 0x140>;
        clock-names = "hsio", "suspend"; // inline comment
        interrupts = <0x0 0x95 0x4>;
        ranges;
        status = "okay";

        usb@38200000 {
            compatible = "snps,dwc3";
            phys = <0x83 0x83>;
            phy-names = "usb2-phy", "usb3-phy";
            dr_mode = "host";
            status = "okay";
        };
    };
};
`;

		const result = dtsPare(sample);

		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);

		expect(result.root.fullName).toBe("/");
		const chosen = findNode(result.root, "/chosen");
		expect(chosen).toBeDefined();
		const bootargs = getProperty(chosen!, "bootargs");
		expect(bootargs?.value).toBe("console=ttyS0,115200");

		const usb = findNode(result.root, "/usb@32f10108");
		expect(usb).toBeDefined();
		const nestedUsb = findNode(result.root, "/usb@32f10108/usb@38200000");
		expect(nestedUsb).toBeDefined();

		const compatible = getProperty(usb!, "compatible");
		expect(compatible?.value).toBe("fsl,imx8mp-dwc3");

		const phandle = getProperty(usb!, "phandle");
		expect(phandle?.type).toBe("cell-list");
		expect(phandle?.value).toEqual([131]);

		const clockNames = getProperty(usb!, "clock-names");
		expect(clockNames?.value).toEqual(["hsio", "suspend"]);

		const rangesProp = getProperty(usb!, "ranges");
		expect(rangesProp?.type).toBe("boolean");
		expect(rangesProp?.value).toBe(true);

		const nestedStatus = getProperty(nestedUsb!, "status");
		expect(nestedStatus?.value).toBe("okay");
	});

	test("records errors for malformed trees", () => {
		const broken = `
/ {
    node {
        key = "value";
    ;
`;

		const result = dtsPare(broken);

		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toMatch(/Unclosed node/);
	});

        test("captures remote-endpoint and phandle references", () => {
                const snippet = `
/ {
  ldb-display-controller {
    lvds-channel@0 {
      port@0 {
        endpoint {
          remote-endpoint = <0x85>;
          phandle = <0x5f>;
        };
      };

      port@1 {
        endpoint {
          remote-endpoint = <0x86>;
          phandle = <0xa2>;
        };
      };
    };

    lvds-channel@1 {
      port {
        endpoint {
          remote-endpoint = <0x88>;
          phandle = <0x60>;
        };
      };
    };
  };
};
`;

		const result = dtsPare(snippet);
		expect(result.errors).toEqual([]);

		const controller = findNode(result.root, "/ldb-display-controller");
		expect(controller).toBeDefined();

		const endpoints = [
			"/ldb-display-controller/lvds-channel@0/port@0/endpoint",
			"/ldb-display-controller/lvds-channel@0/port@1/endpoint",
			"/ldb-display-controller/lvds-channel@1/port/endpoint",
		];

		endpoints.forEach((path, index) => {
			const endpoint = findNode(result.root, path);
			expect(endpoint).toBeDefined();

			const remote = getProperty(endpoint!, "remote-endpoint");
			expect(remote?.type).toBe("cell-list");
			expect(remote?.value).toEqual([[0x85], [0x86], [0x88]][index]);

			const phandle = getProperty(endpoint!, "phandle");
			expect(phandle?.type).toBe("cell-list");
			expect(phandle?.value).toEqual([[0x5f], [0xa2], [0x60]][index]);
                });
        });

        test("parses rsb3720a2 example and keeps brightness levels numeric", () => {
                const payload = readFileSync(
                        new URL("./examples/rsb3720a2.dts", import.meta.url),
                        "utf8",
                );
                const result = dtsPare(payload);

                expect(result.errors).toEqual([]);

                const brightnessProperty = findProperty(result.root, "brightness-levels");
                expect(brightnessProperty).toBeDefined();
                expect(brightnessProperty?.type).toBe("cell-list");

                const flattened: number[] = [];
                const inspect = (value: unknown) => {
                        if (Array.isArray(value)) {
                                value.forEach(inspect);
                                return;
                        }
                        if (typeof value === "number") {
                                flattened.push(value);
                        }
                        if (value && typeof value === "object" && "ref" in value) {
                                throw new Error("brightness-levels should not contain references");
                        }
                };

                inspect(brightnessProperty!.value as unknown);
                expect(flattened.length).toBeGreaterThan(0);
                expect(flattened.every((entry) => typeof entry === "number")).toBe(true);
                expect(flattened[0]).toBe(0);
                expect(flattened[flattened.length - 1]).toBe(0x64);
        });

        test("parses rk3588 example and surfaces overlay diagnostics", () => {
                const payload = readFileSync(
                        new URL("./examples/rk3588-evb1-v10.dts", import.meta.url),
                        "utf8",
                );
                const result = dtsPare(payload);

                expect(result.errors.length).toBeGreaterThan(0);
                expect(
                        result.errors.some((message) =>
                                message.includes("Malformed node declaration"),
                        ),
                ).toBe(true);

                const modelProp = findProperty(result.root, "model");
                expect(modelProp?.value).toBe("Rockchip RK3588 EVB1 V10 Board");
        });
});

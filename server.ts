import index from "./index.html";

Bun.serve({
	port: 6555,
	routes: {
		"/": index,
	},
});

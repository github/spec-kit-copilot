import { createServer } from "node:http";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const servers = new Map();
await joinSession({ canvases: [createCanvas({
    id: "fixture",
    displayName: "Fixture",
    description: "Canvas scaffold fixture",
    actions: [{
        name: "example_action",
        handler: async (ctx) => ({ instanceId: ctx.instanceId }),
    }],
    open: async (ctx) => {
        const server = createServer((_req, res) => res.end("Fixture"));
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        servers.set(ctx.instanceId, server);
        return { url: `http://127.0.0.1:${server.address().port}/` };
    },
    onClose: async (ctx) => {
        const server = servers.get(ctx.instanceId);
        await new Promise((resolve) => server.close(resolve));
        servers.delete(ctx.instanceId);
    },
})] });

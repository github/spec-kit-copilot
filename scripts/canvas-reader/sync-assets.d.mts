export function createBuildMetadata(moduleIds: readonly string[]): Promise<{
    schemaVersion: number;
    sourceHash: string;
    dependencies: readonly { name: string; version: string; license: string; notice: string }[];
    builtWith: { node: string; packageManager: string; typescript: string; bundler: string };
}>;

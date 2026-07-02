/**
 * KSA-156: MCP Tool Registration for code_impact.
 */
export declare const IMPACT_TOOL_DEFINITIONS: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            symbol: {
                type: string;
                description: string;
            };
            action: {
                type: string;
                enum: string[];
                description: string;
            };
            depth: {
                type: string;
                description: string;
            };
            include_tests: {
                type: string;
                description: string;
            };
            severity_threshold: {
                type: string;
                enum: string[];
                description: string;
            };
        };
        required: string[];
    };
}[];
export declare function handleCodeImpact(args: Record<string, unknown>, db: any, workspace: string): Promise<string>;

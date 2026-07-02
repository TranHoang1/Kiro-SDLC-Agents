/**
 * KSA-154: MCP Tool Registration for code_callers and code_callees.
 */
export declare const CALL_GRAPH_TOOL_DEFINITIONS: ({
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            symbol: {
                type: string;
                description: string;
            };
            depth: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            file_filter: {
                type: string;
                description: string;
            };
            kind_filter: {
                type: string;
                description: string;
            };
            include_external?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            symbol: {
                type: string;
                description: string;
            };
            depth: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            file_filter: {
                type: string;
                description: string;
            };
            include_external: {
                type: string;
                description: string;
            };
            kind_filter?: undefined;
        };
        required: string[];
    };
})[];
export declare function handleCodeCallers(args: Record<string, unknown>, db: any): Promise<string>;
export declare function handleCodeCallees(args: Record<string, unknown>, db: any): Promise<string>;

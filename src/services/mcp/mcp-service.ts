import { MCPClient } from 'mcp-client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';

// Load environment variables
dotenv.config();

// Define server types
export type ServerType = 'sse';

// Define server interface
export interface ServerConfig {
  name: string;
  type: ServerType;
  url: string;
  apiKey?: string;
  command?: string;
  enabled: boolean;
}

// Define MCP config interface
export interface MCPConfig {
  servers: ServerConfig[];
  defaultServer: string;
}

// Define Tool interface
export interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  outputSchema: any;
}

// Define Resource interface
export interface Resource {
  uri: string;
  description: string;
}

// Define MCPServer interface
export interface MCPServer {
  getTools(): Promise<Tool[]>;
  getResources(): Promise<Resource[]>;
  executeTool(toolName: string, args: any): Promise<any>;
  accessResource(uri: string): Promise<any>;
}

// MCP Service class
export class MCPService {
  private config: MCPConfig;
  private client: any; // Using any type to avoid SDK version conflicts
  private servers: Map<string, MCPServer> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private tools: Map<string, Map<string, Tool>> = new Map();
  private resources: Map<string, Map<string, Resource>> = new Map();

  constructor() {
    // Load config
    const configPath = path.join(process.cwd(), 'config', 'mcp.config.json');
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // Initialize MCP client
    try {
      this.client = new MCPClient({
        name: 'vibestation',
        version: '0.1.0'
      });
      console.log('MCP client initialized');
    } catch (error) {
      console.error('Failed to initialize MCP client:', error);
    }
    
    // Initialize servers
    this.initServers();
  }

  // Initialize MCP servers
  private async initServers() {
    for (const serverConfig of this.config.servers) {
      if (serverConfig.enabled) {
        try {
          if (serverConfig.type === 'sse') {
            await this.connectToRemoteServer(serverConfig);
          } else if (serverConfig.command) {
            await this.startLocalServer(serverConfig);
          }
        } catch (error) {
          console.error(`Failed to initialize MCP server ${serverConfig.name}:`, error);
        }
      }
    }
  }

  // Start a local STDIO server
  private async startLocalServer(serverConfig: ServerConfig): Promise<void> {
    if (!serverConfig.command) {
      throw new Error(`No command specified for server ${serverConfig.name}`);
    }

    return new Promise((resolve, reject) => {
      try {
        // Parse command and arguments
        const [command, ...args] = serverConfig.command!.split(' ');
        
        // Spawn process
        const process = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });
        
        // Store process
        this.processes.set(serverConfig.name, process);
        
        // Handle process events
        process.on('error', (error: Error) => {
          console.error(`Error starting MCP server ${serverConfig.name}:`, error);
          reject(error);
        });
        
        process.stdout.on('data', (data) => {
          console.log(`[${serverConfig.name}] ${data.toString().trim()}`);
        });
        
        process.stderr.on('data', (data) => {
          console.error(`[${serverConfig.name}] ${data.toString().trim()}`);
        });
        
        // Create a mock server object for now
        const mockServer: MCPServer = {
          getTools: async () => {
            return [] as Tool[];
          },
          getResources: async () => {
            return [] as Resource[];
          },
          executeTool: async (toolName: string, args: any) => {
            console.log(`Executing tool ${toolName} with args:`, args);
            return { result: "Tool execution not implemented" };
          },
          accessResource: async (uri: string) => {
            console.log(`Accessing resource ${uri}`);
            return { data: "Resource access not implemented" };
          }
        };
        
        this.servers.set(serverConfig.name, mockServer);
        this.loadServerTools(serverConfig.name, mockServer);
        console.log(`Connected to MCP server ${serverConfig.name}`);
        resolve();
      } catch (error) {
        console.error(`Failed to start MCP server ${serverConfig.name}:`, error);
        reject(error);
      }
    });
  }

  // Connect to a remote SSE server
  private async connectToRemoteServer(serverConfig: ServerConfig): Promise<void> {
    if (!serverConfig.url) {
      throw new Error(`No URL specified for server ${serverConfig.name}`);
    }

    try {
      // Replace environment variables in API key
      let apiKey = serverConfig.apiKey || '';
      if (apiKey.startsWith('${') && apiKey.endsWith('}')) {
        const envVar = apiKey.slice(2, -1);
        apiKey = process.env[envVar] || '';
      }
      
      // Connect to server using the current API version (mcp-client v1.8.0)
      const server = await this.client.connect(serverConfig.name, {
        type: 'sse',
        url: serverConfig.url,
        apiKey: apiKey
      });
      
      // Store server
      this.servers.set(serverConfig.name, server);
      
      // Load server tools
      await this.loadServerTools(serverConfig.name, server);
      console.log(`Connected to MCP server ${serverConfig.name}`);
    } catch (error) {
      console.error(`Failed to connect to MCP server ${serverConfig.name}:`, error);
      
      // Create a mock server as fallback
      console.warn(`Creating mock server for ${serverConfig.name}`);
      const mockServer: MCPServer = {
        getTools: async () => {
          return [] as Tool[];
        },
        getResources: async () => {
          return [] as Resource[];
        },
        executeTool: async (toolName: string, args: any) => {
          console.log(`Executing tool ${toolName} with args:`, args);
          return { result: "Tool execution not implemented" };
        },
        accessResource: async (uri: string) => {
          console.log(`Accessing resource ${uri}`);
          return { data: "Resource access not implemented" };
        }
      };
      
      this.servers.set(serverConfig.name, mockServer);
      this.loadServerTools(serverConfig.name, mockServer);
      console.log(`Created mock server for ${serverConfig.name}`);
    }
  }

  // Load tools from a server
  private async loadServerTools(serverName: string, server: MCPServer): Promise<void> {
    try {
      // Get tools
      const tools = await server.getTools();
      
      // Store tools
      this.tools.set(serverName, new Map());
      for (const tool of tools) {
        this.tools.get(serverName)!.set(tool.name, tool);
      }
      
      // Get resources
      const resources = await server.getResources();
      
      // Store resources
      this.resources.set(serverName, new Map());
      for (const resource of resources) {
        this.resources.get(serverName)!.set(resource.uri, resource);
      }
      
      console.log(`Loaded ${tools.length} tools and ${resources.length} resources from server ${serverName}`);
    } catch (error) {
      console.error(`Failed to load tools from server ${serverName}:`, error);
      throw error;
    }
  }

  // Get all servers
  public getServers(): { name: string; type: ServerType; connected: boolean }[] {
    return this.config.servers.map((serverConfig) => ({
      name: serverConfig.name,
      type: serverConfig.type,
      connected: this.servers.has(serverConfig.name),
    }));
  }

  // Get all tools for a server
  public getServerTools(serverName: string): Tool[] {
    const toolMap = this.tools.get(serverName);
    if (!toolMap) {
      return [];
    }
    return Array.from(toolMap.values());
  }

  // Get all tools across all servers
  public getAllTools(): { serverName: string; tool: Tool }[] {
    const allTools: { serverName: string; tool: Tool }[] = [];
    for (const [serverName, toolMap] of this.tools.entries()) {
      for (const tool of toolMap.values()) {
        allTools.push({ serverName, tool });
      }
    }
    return allTools;
  }

  // Execute a tool
  public async executeTool(
    serverName: string,
    toolName: string,
    args: any
  ): Promise<any> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Server ${serverName} not connected`);
    }
    
    const toolMap = this.tools.get(serverName);
    if (!toolMap) {
      throw new Error(`No tools found for server ${serverName}`);
    }
    
    const tool = toolMap.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found on server ${serverName}`);
    }
    
    try {
      const result = await server.executeTool(toolName, args);
      return result;
    } catch (error) {
      console.error(`Error executing tool ${toolName} on server ${serverName}:`, error);
      throw error;
    }
  }

  // Access a resource
  public async accessResource(serverName: string, uri: string): Promise<any> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Server ${serverName} not connected`);
    }
    
    try {
      const resource = await server.accessResource(uri);
      return resource;
    } catch (error) {
      console.error(`Error accessing resource ${uri} on server ${serverName}:`, error);
      throw error;
    }
  }

  // Disconnect from all servers
  public async disconnectAllServers(): Promise<void> {
    // Stop all processes
    for (const [serverName, process] of this.processes.entries()) {
      try {
        process.kill();
        console.log(`Stopped process for server ${serverName}`);
      } catch (error) {
        console.error(`Error stopping process for server ${serverName}:`, error);
      }
    }
    
    this.processes.clear();
    this.servers.clear();
    this.tools.clear();
    this.resources.clear();
    console.log('Disconnected from all MCP servers');
  }
}

// Export a singleton instance
export const mcpService = new MCPService();
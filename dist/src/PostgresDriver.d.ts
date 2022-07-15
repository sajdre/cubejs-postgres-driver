import { Pool, PoolConfig, PoolClient } from 'pg';
import { BaseDriver, DownloadQueryResultsOptions, DownloadTableMemoryData, DriverInterface, IndexesSQL, TableStructure, StreamOptions, StreamTableDataWithTypes, QueryOptions } from '@cubejs-backend/query-orchestrator';
export declare type PostgresDriverConfiguration = Partial<PoolConfig> & {
    storeTimezone?: string;
    executionTimeout?: number;
    readOnly?: boolean;
};
export declare class PostgresDriver<C extends PostgresDriverConfiguration = PostgresDriverConfiguration> extends BaseDriver implements DriverInterface {
    protected readonly pool: Pool;
    protected readonly config: Partial<C>;
    constructor(config?: Partial<C>);
    /**
     * The easist way how to add additional configuration from env variables, because
     * you cannot call method in RedshiftDriver.constructor before super.
     */
    protected getInitialConfiguration(): Partial<C>;
    testConnection(): Promise<void>;
    protected prepareConnection(conn: PoolClient, options?: {
        executionTimeout: number;
    }): Promise<void>;
    stream(query: string, values: unknown[], { highWaterMark }: StreamOptions): Promise<StreamTableDataWithTypes>;
    protected queryResponse(query: string, values: unknown[]): Promise<import("pg").QueryResult<any>>;
    query<R = unknown>(query: string, values: unknown[], options?: QueryOptions): Promise<R[]>;
    downloadQueryResults(query: string, values: unknown[], options: DownloadQueryResultsOptions): Promise<StreamTableDataWithTypes | {
        rows: any[];
        types: {
            name: string;
            type: string;
        }[];
    }>;
    readOnly(): boolean;
    uploadTableWithIndexes(table: string, columns: TableStructure, tableData: DownloadTableMemoryData, indexesSql: IndexesSQL): Promise<void>;
    release(): Promise<void>;
    param(paramIndex: number): string;
    fromGenericType(columnType: string): string;
}
//# sourceMappingURL=PostgresDriver.d.ts.map
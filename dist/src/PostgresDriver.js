"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresDriver = void 0;
const pg_1 = require("pg");
const sqlFix_js_1 = require("./sqlFix.js");
const moment = __importStar(require("moment"));
const query_orchestrator_1 = require("@cubejs-backend/query-orchestrator");
const QueryStream_1 = require("./QueryStream");
const GenericTypeToPostgres = {
    string: 'text',
    double: 'decimal',
};
const DataTypeMapping = {};
Object.entries(pg_1.types.builtins).forEach(pair => {
    const [key, value] = pair;
    DataTypeMapping[value] = key;
});
const timestampDataTypes = [1114, 1184];
const timestampTypeParser = (val) => moment.utc(val).format(moment.HTML5_FMT.DATETIME_LOCAL_MS);
function getTypeParser(dataType, format) {
    const isTimestamp = timestampDataTypes.includes(dataType);
    if (isTimestamp) {
        return timestampTypeParser;
    }
    const parser = pg_1.types.getTypeParser(dataType, format);
    return (val) => parser(val);
}
class PostgresDriver extends query_orchestrator_1.BaseDriver {
    constructor(config = {}) {
        super();
        this.pool = new pg_1.Pool({
            max: process.env.CUBEJS_DB_MAX_POOL && parseInt(process.env.CUBEJS_DB_MAX_POOL, 10) || 8,
            idleTimeoutMillis: 30000,
            host: process.env.CUBEJS_DB_HOST,
            database: process.env.CUBEJS_DB_NAME,
            port: process.env.CUBEJS_DB_PORT,
            user: process.env.CUBEJS_DB_USER,
            password: process.env.CUBEJS_DB_PASS,
            ssl: this.getSslOptions(),
            ...config
        });
        this.pool.on('error', (err) => {
            console.log(`Unexpected error on idle client: ${err.stack || err}`); // TODO
        });
        this.config = {
            ...this.getInitialConfiguration(),
            ...config,
        };
    }
    /**
     * The easist way how to add additional configuration from env variables, because
     * you cannot call method in RedshiftDriver.constructor before super.
     */
    getInitialConfiguration() {
        return {};
    }
    async testConnection() {
        try {
            await this.pool.query('SELECT $1::int AS number', ['1']);
        }
        catch (e) {
            if (e.toString().indexOf('no pg_hba.conf entry for host') !== -1) {
                throw new Error(`Please use CUBEJS_DB_SSL=true to connect: ${e.toString()}`);
            }
            throw e;
        }
    }
    async prepareConnection(conn, options = {
        executionTimeout: this.config.executionTimeout ? (this.config.executionTimeout) * 1000 : 600000
    }) {
        await conn.query(`SET TIME ZONE '${this.config.storeTimezone || 'UTC'}'`);
        await conn.query(`set statement_timeout to ${options.executionTimeout}`);
    }
    async stream(query, values, { highWaterMark }) {
        const conn = await this.pool.connect();
        try {
            await this.prepareConnection(conn);
            const queryStream = new QueryStream_1.QueryStream(query, values, {
                types: {
                    getTypeParser,
                },
                highWaterMark
            });
            const rowStream = await conn.query(queryStream);
            const meta = await rowStream.fields();
            return {
                rowStream,
                types: meta.map((f) => ({
                    name: f.name,
                    type: this.toGenericType(DataTypeMapping[f.dataTypeID].toLowerCase())
                })),
                release: async () => {
                    await conn.release();
                }
            };
        }
        catch (e) {
            await conn.release();
            throw e;
        }
    }
    async queryResponse(query, values) {
        const conn = await this.pool.connect();
        try {
            await this.prepareConnection(conn);
            const res = await conn.query({
                text: sqlFix_js_1.fixSql(query),
                values: values || [],
                types: {
                    getTypeParser,
                },
            });
            return res;
        }
        finally {
            await conn.release();
        }
    }
    async query(query, values, options) {
        const result = await this.queryResponse(query, values);
        return result.rows;
    }
    async downloadQueryResults(query, values, options) {
        if (options.streamImport) {
            return this.stream(query, values, options);
        }
        const res = await this.queryResponse(query, values);
        return {
            rows: res.rows,
            types: res.fields.map(f => ({
                name: f.name,
                type: this.toGenericType(DataTypeMapping[f.dataTypeID].toLowerCase())
            })),
        };
    }
    readOnly() {
        return !!this.config.readOnly;
    }
    async uploadTableWithIndexes(table, columns, tableData, indexesSql) {
        if (!tableData.rows) {
            throw new Error(`${this.constructor} driver supports only rows upload`);
        }
        await this.createTable(table, columns);
        try {
            await this.query(`INSERT INTO ${table}
      (${columns.map(c => this.quoteIdentifier(c.name)).join(', ')})
      SELECT * FROM UNNEST (${columns.map((c, columnIndex) => `${this.param(columnIndex)}::${this.fromGenericType(c.type)}[]`).join(', ')})`, columns.map(c => tableData.rows.map(r => r[c.name])));
            for (let i = 0; i < indexesSql.length; i++) {
                const [query, p] = indexesSql[i].sql;
                await this.query(query, p);
            }
        }
        catch (e) {
            await this.dropTable(table);
            throw e;
        }
    }
    release() {
        return this.pool.end();
    }
    param(paramIndex) {
        return `$${paramIndex + 1}`;
    }
    fromGenericType(columnType) {
        return GenericTypeToPostgres[columnType] || super.fromGenericType(columnType);
    }
}
exports.PostgresDriver = PostgresDriver;
//# sourceMappingURL=PostgresDriver.js.map
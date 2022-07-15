"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryStream = void 0;
const pg_query_stream_1 = __importDefault(require("pg-query-stream"));
class QueryStream extends pg_query_stream_1.default {
    fields() {
        return new Promise((resolve, reject) => {
            this.cursor.read(100, (err, rows, result) => {
                if (err) {
                    // https://nodejs.org/api/stream.html#stream_errors_while_reading
                    this.destroy(err);
                    reject(err);
                }
                else {
                    // eslint-disable-next-line no-restricted-syntax
                    for (const row of rows) {
                        this.push(row);
                    }
                    if (rows.length < 1) {
                        this.push(null);
                    }
                    resolve(result.fields);
                }
            });
        });
    }
}
exports.QueryStream = QueryStream;
//# sourceMappingURL=QueryStream.js.map
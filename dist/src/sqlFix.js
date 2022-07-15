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
exports.fixSql = void 0;
const R = __importStar(require("ramda"));
const pgsql_parser_1 = require("pgsql-parser");
const uuid_1 = require("uuid");
const getNewAExpr = (A_Expr, name) => ({ A_Expr: R.merge(A_Expr, { lexpr: { ColumnRef: {
                fields: [
                    { ["String"]: { str: name } }
                ]
            } } }) });
const getNewNullTest = (NullTest, name) => ({ NullTest: R.merge(NullTest, { arg: { ColumnRef: {
                fields: [
                    { ["String"]: { str: name } }
                ]
            } } }) });
const havingToWhereExpr = (havingExpr, targetList) => R.ifElse(R.prop("BoolExpr"), R.over(R.lensPath(["BoolExpr", "args"]), args => R.map(arg => havingToWhereExpr(arg, targetList), args)), (expression) => {
    var _a, _b, _c, _d;
    const { A_Expr, NullTest } = expression;
    const lexpr = (A_Expr === null || A_Expr === void 0 ? void 0 : A_Expr.lexpr);
    if (lexpr) {
        const lexprSql = pgsql_parser_1.deparse([lexpr]);
        const target = R.find(target => {
            var _a;
            const currentTargetValueSql = pgsql_parser_1.deparse([(_a = target === null || target === void 0 ? void 0 : target.ResTarget) === null || _a === void 0 ? void 0 : _a.val]);
            return R.equals(lexprSql, currentTargetValueSql);
        }, targetList);
        if (!target) {
            const targetToInsert = { ResTarget: {
                    name: uuid_1.v4(),
                    val: lexpr
                } };
            targetList.push(targetToInsert);
            return getNewAExpr(A_Expr, (_a = targetToInsert === null || targetToInsert === void 0 ? void 0 : targetToInsert.ResTarget) === null || _a === void 0 ? void 0 : _a.name);
        }
        return getNewAExpr(A_Expr, (_b = target === null || target === void 0 ? void 0 : target.ResTarget) === null || _b === void 0 ? void 0 : _b.name);
    }
    if (NullTest) {
        const argSql = pgsql_parser_1.deparse([NullTest === null || NullTest === void 0 ? void 0 : NullTest.arg]);
        const target = R.find(target => {
            var _a;
            const currentTargetValueSql = pgsql_parser_1.deparse([(_a = target === null || target === void 0 ? void 0 : target.ResTarget) === null || _a === void 0 ? void 0 : _a.val]);
            return R.equals(argSql, currentTargetValueSql);
        }, targetList);
        if (!target) {
            const targetToInsert = { ResTarget: {
                    name: uuid_1.v4(),
                    val: lexpr
                } };
            targetList.push(targetToInsert);
            return getNewNullTest(NullTest, (_c = targetToInsert === null || targetToInsert === void 0 ? void 0 : targetToInsert.ResTarget) === null || _c === void 0 ? void 0 : _c.name);
        }
        return getNewNullTest(NullTest, (_d = target === null || target === void 0 ? void 0 : target.ResTarget) === null || _d === void 0 ? void 0 : _d.name);
    }
    return expression;
})(havingExpr);
const typeCast = arg => ({
    TypeCast: {
        arg,
        typeName: {
            TypeName: {
                typemod: -1,
                names: [{ String: {
                            str: "text"
                        } }]
            }
        }
    }
});
const whereTree = [0, "RawStmt", "stmt", "SelectStmt", "whereClause"];
const aExprNamePath = ["A_Expr", "name", 0, "String", "str"];
const boolArgsPath = ["BoolExpr", "args"];
const isBoolExpr = R.path(["BoolExpr"]);
const lexprPath = ["A_Expr", "lexpr"];
const isLike = expr => R.path(aExprNamePath)(expr) === "~~*";
const convertLikeExpressions = R.cond([
    [isBoolExpr, expression => {
            return R.over(R.lensPath(boolArgsPath), R.map(arg => convertLikeExpressions(arg)))(expression);
        }],
    [isLike, R.over(R.lensPath(lexprPath), lexpr => typeCast(lexpr))],
    [R.T, R.identity]
]);
const numberLikeFix = sql => {
    const parsedSql = pgsql_parser_1.parse(sql);
    const where = R.path(whereTree, parsedSql);
    const fixedWhere = convertLikeExpressions(where);
    if (!R.equals(where, fixedWhere)) {
        const fixedSql = R.set(R.lensPath(whereTree), fixedWhere)(parsedSql);
        return pgsql_parser_1.deparse(fixedSql);
    }
    return sql;
};
const windowFunctionsFix = sql => R.when(() => {
    const ast = pgsql_parser_1.parse(sql);
    return R.path([0, "RawStmt", "stmt", "SelectStmt", "havingClause"])(ast);
}, () => {
    const ast = pgsql_parser_1.parse(sql);
    const targetList = R.path([0, "RawStmt", "stmt", "SelectStmt", "targetList"])(ast);
    const havingAst = R.path([0, "RawStmt", "stmt", "SelectStmt", "havingClause"])(ast);
    const sortClauseAst = R.path([0, "RawStmt", "stmt", "SelectStmt", "sortClause"])(ast);
    const sortClauseSql = R.ifElse(R.isNil, () => "", clauses => `ORDER BY ${R.join(", ", R.map(clause => pgsql_parser_1.deparse([clause]), clauses))}`)(sortClauseAst);
    const limitCountAst = R.path([0, "RawStmt", "stmt", "SelectStmt", "limitCount"])(ast);
    const limitClauseSql = R.ifElse(R.isNil, () => "", clause => `LIMIT ${pgsql_parser_1.deparse([clause])}`)(limitCountAst);
    const whereClauseAst = havingToWhereExpr(havingAst, targetList);
    const whereClauseSql = `WHERE ${pgsql_parser_1.deparse([whereClauseAst])}`;
    const newAst = R.assocPath([0, "RawStmt", "stmt", "SelectStmt", "targetList"], targetList, ast);
    const withoutAst = R.compose(R.over(R.lensPath([0, "RawStmt", "stmt", "SelectStmt"]), R.omit(["limitCount"])), R.over(R.lensPath([0, "RawStmt", "stmt", "SelectStmt"]), R.omit(["sortClause"])), R.over(R.lensPath([0, "RawStmt", "stmt", "SelectStmt"]), R.omit(["havingClause"])))(newAst);
    const withoutHavingSql = pgsql_parser_1.deparse(withoutAst);
    const resultSql = `SELECT * FROM (${withoutHavingSql}) AS "RESULT" ${whereClauseSql} ${sortClauseSql} ${limitClauseSql}`;
    console.log("Result sql: ", resultSql);
    return resultSql;
})(sql);
const fixSql = sql => {
    return R.compose(numberLikeFix, windowFunctionsFix)(sql);
};
exports.fixSql = fixSql;
//# sourceMappingURL=sqlFix.js.map
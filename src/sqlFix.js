import * as R from "ramda"
import {parse, deparse} from "pgsql-parser"
import {v4} from "uuid"

const getNewAExpr = (A_Expr, name) => ({A_Expr: R.merge(A_Expr, {lexpr: {ColumnRef: {
  fields: [
    {["String"]: {str: name}}
  ]
}}})})

const getNewNullTest = (NullTest, name) => ({NullTest: R.merge(NullTest, {arg: {ColumnRef: {
  fields: [
    {["String"]: {str: name}}
  ]
}}})})

const havingToWhereExpr = (havingExpr, targetList) => R.ifElse(
  R.prop("BoolExpr"),
  R.over(R.lensPath(["BoolExpr", "args"]), args => R.map(arg => havingToWhereExpr(arg, targetList), args)),
  (expression) => {
    const {A_Expr, NullTest} = expression
    
    const lexpr = (A_Expr?.lexpr)

    if (lexpr) {
      const lexprSql = deparse([lexpr])
      const target = R.find(target => {
        const currentTargetValueSql = deparse([target?.ResTarget?.val])
        return R.equals(lexprSql, currentTargetValueSql)
      }, targetList)
  
      if (!target) {
        const targetToInsert = {ResTarget: {
          name: v4(),
          val: lexpr
        }}
        targetList.push(targetToInsert)
        return getNewAExpr(A_Expr, targetToInsert?.ResTarget?.name)
      }
      return getNewAExpr(A_Expr, target?.ResTarget?.name)
    }

    if (NullTest) {
      const argSql = deparse([NullTest?.arg])
      const target = R.find(target => {
        const currentTargetValueSql = deparse([target?.ResTarget?.val])
        return R.equals(argSql, currentTargetValueSql)
      }, targetList)
  
      if (!target) {
        const targetToInsert = {ResTarget: {
          name: v4(),
          val: lexpr
        }}
        targetList.push(targetToInsert)
        return getNewNullTest(NullTest, targetToInsert?.ResTarget?.name)
      }
      return getNewNullTest(NullTest, target?.ResTarget?.name)
    }

    return expression
  }
)(havingExpr)

const typeCast = arg => ({
  TypeCast: {
    arg,
    typeName: {
      TypeName: {
        typemod: -1,
        names: [{String: {
          str: "text"
        }}]
      }
    }
  }
})

const whereTree = [0, "RawStmt", "stmt", "SelectStmt", "whereClause"]
const aExprNamePath = ["A_Expr", "name", 0, "String", "str"]
const boolArgsPath = ["BoolExpr", "args"]
const isBoolExpr = R.path(["BoolExpr"])
const lexprPath = ["A_Expr", "lexpr"]
const isLike = expr => R.path(aExprNamePath)(expr) === "~~*"
const convertLikeExpressions = R.cond([
  [isBoolExpr, expression => {
    return R.over(R.lensPath(boolArgsPath), R.map(arg => convertLikeExpressions(arg)))(expression)
  }],
  [isLike, R.over(R.lensPath(lexprPath), lexpr => typeCast(lexpr))],
  [R.T, R.identity]
])

const numberLikeFix = sql => {
  const parsedSql = parse(sql)
  const where = R.path(whereTree, parsedSql)
  const fixedWhere = convertLikeExpressions(where)

  if (!R.equals(where, fixedWhere)) {
    const fixedSql = R.set(R.lensPath(whereTree), fixedWhere)(parsedSql)
    return deparse(fixedSql)
  }
  return sql
}

const windowFunctionsFix = sql => R.when(
  () => {
    const ast = parse(sql)
    return R.path([0, "RawStmt", "stmt", "SelectStmt", "havingClause"])(ast)
  },
  () => {
    const ast = parse(sql)
    const targetList = R.path([0, "RawStmt", "stmt", "SelectStmt", "targetList"])(ast)
    const havingAst = R.path([0, "RawStmt", "stmt", "SelectStmt", "havingClause"])(ast)

    const sortClauseAst = R.path([0, "RawStmt", "stmt", "SelectStmt", "sortClause"])(ast)
    const sortClauseSql = R.ifElse(
      R.isNil,
      () => "",
      clauses => `ORDER BY ${R.join(", ", R.map(clause => deparse([clause]), clauses))}`
    )(sortClauseAst)

    const limitCountAst = R.path([0, "RawStmt", "stmt", "SelectStmt", "limitCount"])(ast)
    const limitClauseSql = R.ifElse(
      R.isNil,
      () => "",
      clause => `LIMIT ${deparse([clause])}`
    )(limitCountAst)

    const whereClauseAst = havingToWhereExpr(havingAst, targetList)
    const whereClauseSql = `WHERE ${deparse([whereClauseAst])}`

    const newAst = R.assocPath([0, "RawStmt", "stmt", "SelectStmt", "targetList"], targetList, ast)

    const withoutAst = R.compose(
      R.over(R.lensPath([0, "RawStmt", "stmt", "SelectStmt"]), R.omit(["limitCount"])),
      R.over(R.lensPath([0, "RawStmt", "stmt", "SelectStmt"]), R.omit(["sortClause"])),
      R.over(R.lensPath([0, "RawStmt", "stmt", "SelectStmt"]), R.omit(["havingClause"]))
    )(newAst)

    const withoutHavingSql = deparse(withoutAst)
    
    const resultSql =`SELECT *, count(*) over () as "Total Count" FROM (${withoutHavingSql}) AS "RESULT" ${whereClauseSql} ${sortClauseSql} ${limitClauseSql}`

    console.log("Result sql: ", resultSql)

    return resultSql
  }
)(sql)

export const fixSql = sql => {
    return R.compose(
              numberLikeFix,
              windowFunctionsFix
            )(sql)
}

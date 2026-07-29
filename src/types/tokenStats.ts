/**
 * ZCode token 使用量统计类型。
 *
 * 与后端 `crate::zcode::stats::TokenStats` 的 serde camelCase 序列化对齐。
 * 纯类型定义，无运行时依赖。
 */

/** 单个模型的 token 使用统计行。 */
export interface ModelTokenRow {
  /** 模型标识（如 "glm-5.2"）。 */
  modelId: string
  /** 今日 API 调用次数。 */
  calls: number
  /** 今日该模型消耗的总 token 数。 */
  totalTokens: number
}

/** 今日 ZCode token 使用量汇总。 */
export interface TokenStats {
  /** 实际查询的数据库路径（供前端展示）。 */
  dbPath: string
  /** 今日输入 token 总量。 */
  todayInputTokens: number
  /** 今日输出 token 总量。 */
  todayOutputTokens: number
  /** 今日计算总 token。 */
  todayTotalTokens: number
  /** 今日 API 调用总次数。 */
  todayCalls: number
  /** 今日各模型 token 明细（按消耗降序）。 */
  activeModels: ModelTokenRow[]
}

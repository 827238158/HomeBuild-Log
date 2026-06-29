export const relationConfig = {
  derived_from: {
    label: '来源于',
    example: '例如：“复核结果”来源于“现场验收”。',
  },
  relates_to: {
    label: '相关',
    example: '例如：“花砖尺寸”与“花砖采购”相关。',
  },
  implements: {
    label: '执行',
    example: '例如：“门套安装后复核”执行“不返工决定”。',
  },
  resolves: {
    label: '解决',
    example: '例如：“门套遮挡方案”解决“地砖破裂问题”。',
  },
  pays_for: {
    label: '用于支付',
    example: '例如：“500 元预付款”用于支付“花砖采购”。',
  },
  tracks_delivery: {
    label: '跟踪送货',
    example: '例如：“到货后验收”跟踪“花砖采购”的送货进度。',
  },
  supersedes: {
    label: '替代',
    example: '例如：“新铺贴方案”替代“原铺贴方案”。',
  },
  blocks: {
    label: '阻塞',
    example: '例如：“材料未到货”阻塞“墙砖施工”。',
  },
  produces: {
    label: '产生',
    example: '例如：“花色决定”产生“花砖采购”。',
  },
} as const

export type RelationType = keyof typeof relationConfig

export function relationLabel(type: string): string {
  return relationConfig[type as RelationType]?.label ?? '其他关联'
}

export const measurementRoleLabels = {
  material_spec: '材料规格',
  site_measurement: '现场测量',
  design_requirement: '设计要求',
  calculated: '计算结果',
} as const

export type MeasurementRole = keyof typeof measurementRoleLabels

const measurementRoleAliases: Record<string, MeasurementRole> = {
  material_spec: 'material_spec',
  material: 'material_spec',
  spec: 'material_spec',
  '材料规格': 'material_spec',
  site_measurement: 'site_measurement',
  site: 'site_measurement',
  measured: 'site_measurement',
  measurement: 'site_measurement',
  '现场测量': 'site_measurement',
  '实地测量': 'site_measurement',
  design_requirement: 'design_requirement',
  design: 'design_requirement',
  requirement: 'design_requirement',
  '设计要求': 'design_requirement',
  '设计尺寸': 'design_requirement',
  calculated: 'calculated',
  calculated_value: 'calculated',
  derived: 'calculated',
  '计算结果': 'calculated',
  '推算结果': 'calculated',
}

export function normalizeMeasurementRole(value: unknown): MeasurementRole {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return measurementRoleAliases[key] ?? 'site_measurement'
}

const candidateFieldLabels: Record<string, string> = {
  vendor_id: '交易对象（商家）',
  amount: '金额',
  amount_minor: '金额',
  occurred_at: '发生日期',
  occurred_date: '发生日期',
  status: '状态',
  measurement_role: '尺寸用途',
}

export function candidateFieldLabel(value: string): string | null {
  const field = value.trim()
  if (!field) return null
  if (candidateFieldLabels[field]) return candidateFieldLabels[field]
  // 未知内部字段不应直接暴露；自然语言提示仍可正常显示。
  if (/^[a-z][a-z0-9_]*$/i.test(field)) return null
  return field
}


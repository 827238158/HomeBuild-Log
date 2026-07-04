import { describe, expect, it } from 'vitest'

import { candidateFieldLabel, normalizeMeasurementRole } from './recordFields'

describe('recordFields', () => {
  it('将内部候选字段转换为中文并隐藏未知字段名', () => {
    expect(candidateFieldLabel('vendor_id')).toBe('交易对象（商家）')
    expect(candidateFieldLabel('amount_minor')).toBe('金额')
    expect(candidateFieldLabel('发生日期')).toBe('发生日期')
    expect(candidateFieldLabel('private_database_key')).toBeNull()
  })

  it('规范化尺寸用途别名并为未知值提供稳定默认值', () => {
    expect(normalizeMeasurementRole('材料规格')).toBe('material_spec')
    expect(normalizeMeasurementRole('design-requirement')).toBe('design_requirement')
    expect(normalizeMeasurementRole('derived')).toBe('calculated')
    expect(normalizeMeasurementRole('unexpected')).toBe('site_measurement')
  })
})


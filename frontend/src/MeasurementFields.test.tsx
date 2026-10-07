import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MeasurementFields } from './MeasurementFields'
import { defaultPayload, payloadForSave } from './DomainWorkspace'

function Form({ initial }: { initial: Record<string, unknown> }) {
  const [payload, setPayload] = useState(initial)
  const [saved, setSaved] = useState('')
  return <><MeasurementFields payload={payload} onChange={(field, value) => setPayload(current => ({ ...current, [field]: value }))} /><button onClick={() => setSaved(JSON.stringify(payloadForSave('measurement', payload)))}>保存测试</button><output>{saved}</output></>
}

describe('尺寸录入与保存', () => {
  it('五个尺寸项、重复测点和无轴值往返不改名不丢失', () => {
    const values = [
      { axis: '净宽', value: 90, unit: 'cm' },
      { axis: 'height', value: 2.1, unit: 'm' },
      { axis: '墙厚', value: 180, unit: 'mm' },
      { axis: '净宽', value: 898, unit: 'mm' },
      { axis: null, value: 4, unit: 'cm' },
    ]
    const payload = defaultPayload('measurement', { values, approximate: true, tolerance_text: '未含门框', method: '卷尺', measured_at: '2026-10-06T10:00:00+08:00' })
    expect(payloadForSave('measurement', payload)).toMatchObject({
      approximate: true, tolerance_text: '未含门框', method: '卷尺', measured_at: '2026-10-06T10:00:00+08:00',
      values: [
        { axis: '净宽', value: 900, unit: 'mm' }, { axis: 'height', value: 2100, unit: 'mm' },
        { axis: '墙厚', value: 180, unit: 'mm' }, { axis: '净宽', value: 898, unit: 'mm' },
        { axis: null, value: 40, unit: 'mm' },
      ],
    })
  })

  it('增删命名尺寸项、切换单位后保存全部尺寸', () => {
    render(<Form initial={{ values: [{ axis: 'depth', value: 60, unit: 'cm' }] }} />)
    expect(screen.getByLabelText('尺寸名称 1')).toHaveProperty('value', '深度')
    fireEvent.click(screen.getByRole('button', { name: '门洞' }))
    expect(screen.getByLabelText('尺寸名称 4')).toHaveProperty('value', '墙厚')
    fireEvent.change(screen.getByLabelText('尺寸单位 4'), { target: { value: 'cm' } })
    fireEvent.change(screen.getByLabelText('尺寸数值 4'), { target: { value: '18' } })
    fireEvent.click(screen.getByRole('button', { name: '移除尺寸项 2' }))
    fireEvent.change(screen.getByLabelText('尺寸名称 3'), { target: { value: '完成面墙厚' } })
    fireEvent.click(screen.getByRole('button', { name: '保存测试' }))
    expect(JSON.parse(screen.getByRole('status').textContent ?? '{}').values).toEqual([
      { axis: 'depth', value: 600, unit: 'mm' }, { axis: '完成面墙厚', value: 180, unit: 'mm' },
    ])
  })

  it.each([0, -1, '坏数据'])('非法数值 %s 报错而非静默删除', value => {
    expect(() => payloadForSave('measurement', { values: [{ axis: '墙厚', value, unit: 'mm' }] })).toThrow('尺寸数值必须大于 0')
  })

  it('未知单位报错，不伪装成毫米', () => {
    expect(() => payloadForSave('measurement', { values: [{ value: 3, unit: 'inch' }] })).toThrow('尺寸单位请选择')
    expect(payloadForSave('measurement', { values: [{ axis: '墙厚', value: null, unit: 'mm' }] }).values).toEqual([])
  })

  it('测量时间按北京时间显示，编辑后保留明确时区', () => {
    render(<Form initial={{ values: [], measured_at: '2026-10-06T03:15:00Z' }} />)
    const time = screen.getByLabelText('测量时间（北京时间）')
    expect(time).toHaveProperty('value', '2026-10-06T11:15')
    fireEvent.change(time, { target: { value: '2026-10-06T12:30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存测试' }))
    expect(JSON.parse(screen.getByRole('status').textContent ?? '{}').measured_at).toBe('2026-10-06T12:30:00+08:00')
  })

  it('已有数值切换单位不改变实际尺寸', () => {
    render(<Form initial={{ values: [{ axis: '净宽', value: 900.2, unit: 'mm' }] }} />)
    fireEvent.change(screen.getByLabelText('尺寸单位 1'), { target: { value: 'cm' } })
    expect(screen.getByLabelText('尺寸数值 1')).toHaveProperty('value', '90.02')
    fireEvent.change(screen.getByLabelText('尺寸单位 1'), { target: { value: 'm' } })
    expect(screen.getByLabelText('尺寸数值 1')).toHaveProperty('value', '0.9002')
    fireEvent.click(screen.getByRole('button', { name: '保存测试' }))
    expect(JSON.parse(screen.getByRole('status').textContent ?? '{}').values).toEqual([{ axis: '净宽', value: 900.2, unit: 'mm' }])
  })
})

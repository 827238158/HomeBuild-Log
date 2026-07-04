/** 前端集中配置，替代分布在各文件中的硬编码值 */

export const API_BASE = '/api/v1'

export const BACKEND_URL = 'http://127.0.0.1:8000'

export const UPLOAD = {
  maxSize: 50 * 1024 * 1024,
  allowedTypes: new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf',
  ]),
} as const

export const UI = {
  toastDuration: 2000,
} as const

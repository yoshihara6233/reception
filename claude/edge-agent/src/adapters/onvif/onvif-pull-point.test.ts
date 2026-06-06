/**
 * F53.C: PullPoint normalizeOnvifTopic のテスト
 *
 * フル subscribe フローは外部 SOAP に依存するので unit test ではなく
 * トピック→ NvrEventType マッピングだけを確実に検証する。
 */
import { describe, it, expect } from 'vitest'
import { normalizeOnvifTopic } from './onvif-pull-point'

describe('normalizeOnvifTopic', () => {
  it('motion を motion に', () => {
    expect(normalizeOnvifTopic('tns1:VideoSource/MotionAlarm')).toBe('motion')
    expect(normalizeOnvifTopic('tns1:RuleEngine/CellMotionDetector/Motion')).toBe('motion')
  })

  it('signal loss を video_loss に', () => {
    expect(normalizeOnvifTopic('tns1:VideoSource/SignalLoss')).toBe('video_loss')
    expect(normalizeOnvifTopic('tns1:VideoEncoder/VideoLoss')).toBe('video_loss')
  })

  it('tamper を tampering に', () => {
    expect(normalizeOnvifTopic('tns1:RuleEngine/TamperDetector/Tamper')).toBe('tampering')
  })

  it('person/human を ai_person に', () => {
    expect(normalizeOnvifTopic('tns1:RuleEngine/ObjectDetector/Object[Type=Human]')).toBe('ai_person')
    expect(normalizeOnvifTopic('tns1:Analytics/Person')).toBe('ai_person')
  })

  it('vehicle を ai_vehicle に', () => {
    expect(normalizeOnvifTopic('tns1:RuleEngine/ObjectDetector/Object[Type=Vehicle]')).toBe('ai_vehicle')
    expect(normalizeOnvifTopic('tns1:Analytics/Car')).toBe('ai_vehicle')
  })

  it('audio anomaly を audio_anomaly に', () => {
    expect(normalizeOnvifTopic('tns1:AudioDetector/Audio')).toBe('audio_anomaly')
  })

  it('未知トピックは null', () => {
    expect(normalizeOnvifTopic('tns1:Something/Unknown')).toBe(null)
    expect(normalizeOnvifTopic('')).toBe(null)
  })

  it('大文字小文字を区別しない', () => {
    expect(normalizeOnvifTopic('TNS1:VIDEOSOURCE/MOTIONALARM')).toBe('motion')
  })
})

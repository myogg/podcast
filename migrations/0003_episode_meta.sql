-- 记录每集音频的生成来源与真实元信息。
-- audio_size 来自 R2 对象上传后的实际大小，供 /feed.xml 的 enclosure length 使用；
-- duration_seconds 由拼接后的 MP3 帧计算，供 <itunes:duration> 使用；
-- tts_provider 标记实际使用的合成服务（mimo / edge）。
-- SQLite 的 ADD COLUMN 不支持 IF NOT EXISTS，Wrangler 会根据 d1_migrations 只执行一次；
-- 手动在 D1 Console 补列时，请先确认这三列尚不存在。

ALTER TABLE episodes ADD COLUMN tts_provider TEXT;
ALTER TABLE episodes ADD COLUMN audio_size INTEGER;
ALTER TABLE episodes ADD COLUMN duration_seconds INTEGER;

-- 单集摘要，直接来自 RSS 的 <description>（RSS 没给时用标题兜底）。
-- 网站列表、详情页与 /feed.xml 只使用这一列，不再抓取文章页正文来展示。
ALTER TABLE episodes ADD COLUMN description TEXT;

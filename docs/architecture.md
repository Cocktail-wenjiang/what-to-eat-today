# 实验一架构落地说明

项目采用实验一确定的 Python + FastAPI、UniApp（Vue3）用户端、Vue3 + Element Plus 管理后台、LangChain + 第三方模型 API、Supabase、阿里云 OSS、Render 架构。

当前实验四 MVP 先用本地 SQLite 代替 Supabase，使用规则推荐代替模型调用，接口和模块边界保持一致。这样可离线启动、复测，并且后续仅需替换数据仓库和 ModelGateway 实现。

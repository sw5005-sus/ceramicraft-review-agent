# CI 测试环境（GitHub Actions 自动配置）
RUN_ENV=test npm run eval:promptfoo:prerelease
# → Mock 邮件/MLflow，ERROR 日志

# 生产验证
RUN_ENV=production npm run eval:promptfoo:prerelease
# → 真实邮件/MLflow，ERROR 日志

# 本地开发（默认）
npm run eval:promptfoo:prerelease
# 或
RUN_ENV=dev npm run eval:promptfoo:prerelease
# → 真实邮件/MLflow，INFO 日志（全打）
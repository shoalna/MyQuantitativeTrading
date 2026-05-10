from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://trading:trading_pass@postgres:5432/trading"
    news_api_key: str = ""
    anthropic_api_key: str = ""
    jquants_api_key: str = ""
    edinet_api_key: str = ""
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    batch_cron_hour: int = 6

    def get_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

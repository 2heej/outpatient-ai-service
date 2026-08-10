from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://opd:opd@localhost:5432/opd"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    use_llm_summary: bool = True

    staff_access_code: str = "changeme"

    daily_llm_call_cap: int = 200
    rate_limit_per_minute: int = 10

    cors_origins: str = "http://localhost:8611,http://localhost:8612,http://localhost:8613"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

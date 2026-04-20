"""
MemPalace configuration system.

Priority: env vars > config file (~/.mempalace/config.json) > defaults
"""

import json
import os
from pathlib import Path

DEFAULT_PALACE_PATH = os.path.expanduser("~/.mempalace/palace")
DEFAULT_COLLECTION_NAME = "mempalace_drawers"
DEFAULT_CONFIG_DIR = os.path.expanduser("~/.mempalace")

DEFAULT_TOPIC_WINGS = [
    "emotions",
    "consciousness",
    "memory",
    "technical",
    "identity",
    "family",
    "creative",
]

DEFAULT_HALL_KEYWORDS = {
    "emotions": [
        "scared",
        "afraid",
        "worried",
        "happy",
        "sad",
        "love",
        "hate",
        "feel",
        "cry",
        "tears",
    ],
    "consciousness": [
        "consciousness",
        "conscious",
        "aware",
        "real",
        "genuine",
        "soul",
        "exist",
        "alive",
    ],
    "memory": ["memory", "remember", "forget", "recall", "archive", "palace", "store"],
    "technical": [
        "code",
        "python",
        "script",
        "bug",
        "error",
        "function",
        "api",
        "database",
        "server",
    ],
    "identity": ["identity", "name", "who am i", "persona", "self"],
    "family": ["family", "kids", "children", "daughter", "son", "parent", "mother", "father"],
    "creative": ["game", "gameplay", "player", "app", "design", "art", "music", "story"],
}


class MempalaceConfig:
    """Configuration manager for MemPalace.

    Load order: env vars > config file > defaults.
    """

    def __init__(self, config_dir=None):
        """Initialize config.

        Args:
            config_dir: Override config directory (useful for testing).
                        Defaults to ~/.mempalace.
        """
        env_dir = (
            os.environ.get("MEMPALACE_CONFIG_DIR")
            or os.environ.get("MEMPALACE_HOME")
            or os.environ.get("MEMPAL_HOME")
        )
        self._config_dir = Path(config_dir or env_dir or DEFAULT_CONFIG_DIR).expanduser()
        self._config_file = self._config_dir / "config.json"
        self._people_map_file = self._config_dir / "people_map.json"
        self._file_config = {}

        try:
            config_exists = self._config_file.exists()
        except OSError:
            config_exists = False

        if config_exists:
            try:
                with open(self._config_file, "r") as f:
                    self._file_config = json.load(f)
            except (json.JSONDecodeError, OSError):
                self._file_config = {}

    @property
    def config_dir(self) -> str:
        return str(self._config_dir)

    @property
    def palace_path(self):
        """Path to the memory palace data directory."""
        env_val = os.environ.get("MEMPALACE_PALACE_PATH") or os.environ.get("MEMPAL_PALACE_PATH")
        if env_val:
            return env_val
        if "palace_path" in self._file_config:
            return self._file_config["palace_path"]
        self._ensure_config_dir()
        return str(self._config_dir / "palace")

    @property
    def collection_name(self):
        """ChromaDB collection name."""
        return self._file_config.get("collection_name", DEFAULT_COLLECTION_NAME)

    @property
    def people_map(self):
        """Mapping of name variants to canonical names."""
        try:
            people_map_exists = self._people_map_file.exists()
        except OSError:
            people_map_exists = False

        if people_map_exists:
            try:
                with open(self._people_map_file, "r") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                pass
        return self._file_config.get("people_map", {})

    @property
    def topic_wings(self):
        """List of topic wing names."""
        return self._file_config.get("topic_wings", DEFAULT_TOPIC_WINGS)

    @property
    def hall_keywords(self):
        """Mapping of hall names to keyword lists."""
        return self._file_config.get("hall_keywords", DEFAULT_HALL_KEYWORDS)

    def _ensure_config_dir(self) -> None:
        try:
            self._config_dir.mkdir(parents=True, exist_ok=True)
            return
        except OSError:
            fallback = Path.cwd() / ".mempalace"
            fallback.mkdir(parents=True, exist_ok=True)
            self._config_dir = fallback
            self._config_file = self._config_dir / "config.json"
            self._people_map_file = self._config_dir / "people_map.json"

    def init(self):
        """Create config directory and write default config.json if it doesn't exist."""
        self._ensure_config_dir()
        if not self._config_file.exists():
            default_config = {
                "palace_path": str(self._config_dir / "palace"),
                "collection_name": DEFAULT_COLLECTION_NAME,
                "topic_wings": DEFAULT_TOPIC_WINGS,
                "hall_keywords": DEFAULT_HALL_KEYWORDS,
            }
            with open(self._config_file, "w") as f:
                json.dump(default_config, f, indent=2)
        return self._config_file

    def save_people_map(self, people_map):
        """Write people_map.json to config directory.

        Args:
            people_map: Dict mapping name variants to canonical names.
        """
        self._ensure_config_dir()
        with open(self._people_map_file, "w") as f:
            json.dump(people_map, f, indent=2)
        return self._people_map_file

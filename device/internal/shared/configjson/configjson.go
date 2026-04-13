package configjson

import (
	"encoding/json"
	"fmt"
	"os"
)

func Load(path string, target interface{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read config %s: %w", path, err)
	}

	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}

	return nil
}

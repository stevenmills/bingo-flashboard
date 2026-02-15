import { Settings } from "@/components/Settings";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { GameState } from "@/types";
import { DEFAULT_LETTER_COLORS, type BingoUiThemeId } from "@/lib/bingo-ui-colors";

interface Props {
  state: GameState;
  onRefresh: () => void;
}

export function SettingsPage({ state, onRefresh }: Props) {
  const defaultTheme: BingoUiThemeId = "default";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <Settings
          settingsMode="board"
          brightness={state.brightness}
          theme={state.theme}
          colorMode={state.colorMode}
          staticColor={state.staticColor}
          ledTestMode={state.ledTestMode}
          boardAuthGranted={false}
          uiColorTheme={defaultTheme}
          uiCustomColors={DEFAULT_LETTER_COLORS}
          letterColors={DEFAULT_LETTER_COLORS}
          onUiColorThemeChange={() => {}}
          onUiCustomColorChange={() => {}}
          onRefresh={onRefresh}
        />
      </CardContent>
    </Card>
  );
}

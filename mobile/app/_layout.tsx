import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "../src/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "HeartLens" }} />
        <Stack.Screen name="results" options={{ title: "Your read" }} />
        <Stack.Screen name="history" options={{ title: "History" }} />
        <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
      </Stack>
    </>
  );
}

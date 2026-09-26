import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { defaultServerUrl } from "../src/api";
import { Body, Button, Card, Heading } from "../src/components/ui";
import { getServerUrl, setServerUrl } from "../src/storage";
import { colors, radius, space } from "../src/theme";

export default function SettingsScreen() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const fallback = defaultServerUrl();

  useEffect(() => {
    getServerUrl().then((saved) => setUrl(saved ?? ""));
  }, []);

  const save = async () => {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setStatus("The URL needs to start with http:// or https://");
      return;
    }
    await setServerUrl(trimmed);
    setUrl(trimmed);
    setStatus(trimmed ? "Saved." : "Using the default server.");
  };

  const test = async () => {
    const base = url.trim().replace(/\/+$/, "") || fallback;
    setStatus("Checking…");
    try {
      const res = await fetch(`${base}/api/limits`);
      setStatus(res.ok ? `Connected to ${base}` : `Server at ${base} answered ${res.status}.`);
    } catch {
      setStatus(`Couldn't reach ${base}.`);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Heading>Server</Heading>
        <Body muted>
          HeartLens sends what you paste to your own HeartLens server, which holds the API key. Leave this blank to use
          the default.
        </Body>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder={fallback}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Text style={styles.hint}>Default: {fallback}</Text>
        <View style={styles.row}>
          <Button title="Save" onPress={save} />
          <Button title="Test connection" variant="outline" onPress={test} />
        </View>
        {status && <Text style={styles.status}>{status}</Text>}
      </Card>

      <Card>
        <Heading>About</Heading>
        <Body>
          HeartLens analyzes only the text you paste. Results are probability-based estimates about a real person, not
          facts. Nothing is stored on the server; your history lives on this device.
        </Body>
      </Card>

      <Button title="Done" variant="outline" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: 48 },
  input: {
    marginTop: space.md,
    backgroundColor: colors.bg,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    padding: space.md,
    fontSize: 16,
  },
  hint: { color: colors.muted, fontSize: 13, marginTop: 6 },
  row: { flexDirection: "row", gap: space.md, marginTop: space.lg, flexWrap: "wrap" },
  status: { color: colors.accent, marginTop: space.md, fontSize: 15 },
});

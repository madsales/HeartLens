import { Link, router, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { analyze, ApiError, defaultServerUrl, type AnalyzeInput } from "../src/api";
import { Body, Button, Card, Field, Heading } from "../src/components/ui";
import { addToHistory, getDraft, getServerUrl, setDraft } from "../src/storage";
import { colors, space } from "../src/theme";

const EMPTY: AnalyzeInput = { profile: "", conversation: "", about: "" };

export default function AnalyzeScreen() {
  const navigation = useNavigation();
  const [input, setInput] = useState<AnalyzeInput>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerLinks}>
          <Link href="/history" style={styles.headerLink}>History</Link>
          <Link href="/settings" style={styles.headerLink}>Settings</Link>
        </View>
      ),
    });
  }, [navigation]);

  // Restore the draft once, then save changes after a short pause.
  useEffect(() => {
    getDraft().then((draft) => {
      if (draft) setInput({ ...EMPTY, ...draft });
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setDraft(input), 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [input, loaded]);

  const update = (key: keyof AnalyzeInput) => (value: string) => setInput((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    const payload: AnalyzeInput = {
      profile: input.profile.trim(),
      conversation: input.conversation.trim(),
      about: input.about.trim(),
    };
    setError(null);
    if (!payload.profile && !payload.conversation) {
      setError("Paste a profile, a conversation, or both.");
      return;
    }
    setBusy(true);
    try {
      const serverUrl = (await getServerUrl()) || defaultServerUrl();
      const { result, model } = await analyze(serverUrl, payload);
      const entry = await addToHistory({ input: payload, result, model });
      router.push({ pathname: "/results", params: { id: entry.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.tagline}>Decode the connection.</Text>

        <Card>
          <Heading>Understand the vibe before you text</Heading>
          <Body>
            Paste their profile and, if you have one, your conversation so far. HeartLens reads the signals and suggests
            interests, communication style, and opener angles that fit this person.
          </Body>
          <View style={{ height: space.sm }} />
          <Body muted>
            {"Estimates, not facts. Only paste what you'd be comfortable sharing, and leave out names or contact details you don't need."}
          </Body>
        </Card>

        <Card>
          <Field
            label="Their profile"
            hint="Bio, prompts, captions. Anything they wrote about themselves."
            placeholder="e.g. Will make you pasta from scratch. Weekends are for trails and bad karaoke."
            value={input.profile}
            onChangeText={update("profile")}
            style={styles.tall}
          />
          <Field
            label="Your conversation so far"
            optional
            hint="Paste the chat. Mark who said what if it isn't obvious."
            placeholder={"Me: ...\nThem: ..."}
            value={input.conversation}
            onChangeText={update("conversation")}
            style={styles.taller}
          />
          <Field
            label="About you"
            optional
            hint="A line or two so the openers sound like you."
            placeholder="e.g. I'm pretty dry and sarcastic, into climbing and cooking."
            value={input.about}
            onChangeText={update("about")}
          />

          <Button title={busy ? "Reading the signals…" : "Analyze"} onPress={submit} disabled={busy} />
          {busy && <ActivityIndicator color={colors.accent} style={styles.spinner} />}
          {error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          {!busy && (input.profile || input.conversation || input.about) ? (
            <Pressable onPress={() => setInput(EMPTY)} style={styles.clear}>
              <Text style={styles.clearText}>Clear form</Text>
            </Pressable>
          ) : null}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.lg, paddingBottom: 48 },
  tagline: { color: colors.muted, fontSize: 17, marginBottom: space.lg },
  headerLinks: { flexDirection: "row", gap: space.lg },
  headerLink: { color: colors.accent, fontSize: 16 },
  tall: { minHeight: 120 },
  taller: { minHeight: 160 },
  spinner: { marginTop: space.md },
  error: { color: colors.danger, marginTop: space.md, fontSize: 15 },
  clear: { alignSelf: "center", marginTop: space.md },
  clearText: { color: colors.muted, fontSize: 14 },
});

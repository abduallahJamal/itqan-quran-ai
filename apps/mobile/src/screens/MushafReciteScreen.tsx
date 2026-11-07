import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { HideMode, QuranAyah } from "../../../../packages/shared/src/types";
import { useMobileRecitationSocket } from "../hooks/useRecitationSocket";

interface Props {
  apiBaseUrl: string;
  wsBaseUrl: string;
  pageNumber?: number;
}

export function MushafReciteScreen({ apiBaseUrl, wsBaseUrl, pageNumber = 1 }: Props) {
  const [ayahs, setAyahs] = useState<QuranAyah[]>([]);
  const [hideMode, setHideMode] = useState<HideMode>("BLUR_ALL");
  const { connect, cursorWordId, revealedIds } = useMobileRecitationSocket(wsBaseUrl, 1);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/mushaf/page/${pageNumber}`)
      .then((r) => r.json())
      .then((d) => setAyahs(d.ayahs || []));
  }, [apiBaseUrl, pageNumber]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.mushafSheet}>
        {ayahs.map((ayah) => (
          <View key={ayah.id} style={styles.ayahBlock}>
            {ayah.words.map((w) => {
              const isRevealed = hideMode === "NONE" || revealedIds.has(w.id) || w.id < cursorWordId;
              const isCurrent = w.id === cursorWordId;
              return (
                <Text
                  key={w.id}
                  style={[
                    styles.word,
                    !isRevealed && styles.hiddenWord,
                    isCurrent && styles.activeCursor,
                  ]}
                >
                  {isRevealed ? w.display_uthmani : "••••"}{" "}
                </Text>
              );
            })}
            <Text style={styles.ayahEnd}>﴿{ayah.ayah_number}﴾</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.toggleBtn}
          onPress={() => setHideMode((m) => (m === "NONE" ? "BLUR_ALL" : "NONE"))}
        >
          <Text style={styles.btnLabel}>
            {hideMode === "NONE" ? "إخفاء للتسميع" : "إظهار الكلمات"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.micBtn} onPress={connect}>
          <Text style={styles.micLabel}>ابدأ التسميع الصوتي</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#faf7f0" },
  mushafSheet: { padding: 20, direction: "rtl" },
  ayahBlock: { flexDirection: "row-reverse", flexWrap: "wrap", marginBottom: 12 },
  word: { fontSize: 26, lineHeight: 48, color: "#1c1917" },
  hiddenWord: { color: "transparent", backgroundColor: "#e7e5e4", borderRadius: 6 },
  activeCursor: { backgroundColor: "#d1fae5", borderRadius: 6 },
  ayahEnd: { fontSize: 20, color: "#047857", marginHorizontal: 4 },
  bottomBar: {
    flexDirection: "row-reverse",
    justifyContent: "space-around",
    padding: 16,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
  },
  toggleBtn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, backgroundColor: "#f3f4f6" },
  btnLabel: { fontSize: 15, fontWeight: "600", color: "#111827" },
  micBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 999, backgroundColor: "#047857" },
  micLabel: { fontSize: 16, fontWeight: "700", color: "#ffffff" },
});

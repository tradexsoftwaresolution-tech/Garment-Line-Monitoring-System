package com.garmentline.operations.supabase;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.garmentline.operations.config.SupabaseProperties;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.reactive.function.client.WebClient;

class SupabaseAdminClientTest {

  @Test
  void restUriEncodesLiteralPlusSignsInQueryValues() {
    SupabaseAdminClient client =
        new SupabaseAdminClient(
            WebClient.builder(),
            new ObjectMapper(),
            new SupabaseProperties(
                "https://example.supabase.co", null, "service-role", null, null));
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("event_time", "gte.2026-06-18T00:00+05:30");

    String uri = client.restUri("hikvision_face_events", query).toString();

    assertThat(uri)
        .isEqualTo(
            "https://example.supabase.co/rest/v1/hikvision_face_events"
                + "?event_time=gte.2026-06-18T00%3A00%2B05%3A30");
    assertThat(URLDecoder.decode(uri, StandardCharsets.UTF_8))
        .contains("event_time=gte.2026-06-18T00:00+05:30");
  }
}

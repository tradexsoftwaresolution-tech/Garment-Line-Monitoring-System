package com.garmentline.operations.supabase;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.garmentline.operations.config.SupabaseProperties;
import com.garmentline.operations.support.ApiException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.client.ExchangeStrategies;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.util.UriUtils;

@Component
public class SupabaseAdminClient {

  private static final String DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321";
  private static final int DEFAULT_MAX_IN_MEMORY_SIZE = 20 * 1024 * 1024;

  private final WebClient webClient;
  private final ObjectMapper objectMapper;
  private final SupabaseProperties properties;
  private final String baseUrl;

  public SupabaseAdminClient(
      WebClient.Builder webClientBuilder,
      ObjectMapper objectMapper,
      SupabaseProperties properties) {
    this.baseUrl = resolveSetting(properties.url(), "SUPABASE_URL", DEFAULT_SUPABASE_URL);
    String serviceRoleKey =
        resolveSetting(properties.serviceRoleKey(), "SUPABASE_SERVICE_ROLE_KEY", "");

    this.webClient =
        webClientBuilder
            .exchangeStrategies(
                ExchangeStrategies.builder()
                    .codecs(
                        configurer ->
                            configurer.defaultCodecs().maxInMemorySize(DEFAULT_MAX_IN_MEMORY_SIZE))
                    .build())
            .baseUrl(baseUrl)
            .defaultHeader("apikey", serviceRoleKey)
            .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + serviceRoleKey)
            .build();
    this.objectMapper = objectMapper;
    this.properties = properties;
  }

  public ArrayNode select(String table, MultiValueMap<String, String> query) {
    JsonNode response = performGet(restUri(table, query), MediaType.APPLICATION_JSON_VALUE);
    if (response instanceof ArrayNode arrayNode) {
      return arrayNode;
    }

    ArrayNode wrapped = objectMapper.createArrayNode();
    wrapped.add(response);
    return wrapped;
  }

  public ArrayNode selectAll(String table, MultiValueMap<String, String> query) {
    ArrayNode aggregated = objectMapper.createArrayNode();
    int pageSize = 1000;
    int offset = 0;

    while (true) {
      LinkedMultiValueMap<String, String> pageQuery = new LinkedMultiValueMap<>();
      if (query != null) {
        pageQuery.addAll(query);
      }
      pageQuery.set("limit", String.valueOf(pageSize));
      pageQuery.set("offset", String.valueOf(offset));

      ArrayNode page = select(table, pageQuery);
      page.forEach(aggregated::add);

      if (page.size() < pageSize) {
        return aggregated;
      }
      offset += pageSize;
    }
  }

  public ObjectNode selectSingle(String table, MultiValueMap<String, String> query) {
    JsonNode response =
        performGet(restUri(table, query), "application/vnd.pgrst.object+json");
    if (response instanceof ObjectNode objectNode) {
      return objectNode;
    }

    throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Expected a single JSON object from Supabase.");
  }

  public ObjectNode insertSingle(String table, Object payload) {
    return executeObjectRequest(
        webClient
            .post()
            .uri(restUri(table, null))
            .contentType(MediaType.APPLICATION_JSON)
            .header("Prefer", "return=representation")
            .accept(MediaType.valueOf("application/vnd.pgrst.object+json"))
            .bodyValue(payload));
  }

  public ArrayNode insertMany(String table, List<?> payload) {
    if (payload.isEmpty()) {
      return objectMapper.createArrayNode();
    }

    try {
      webClient
          .post()
          .uri(restUri(table, null))
          .contentType(MediaType.APPLICATION_JSON)
          .header("Prefer", "return=minimal")
          .bodyValue(payload)
          .retrieve()
          .toBodilessEntity()
          .block();
      return objectMapper.createArrayNode();
    } catch (WebClientResponseException exception) {
      throw mapException(exception);
    }
  }

  public ArrayNode upsertMany(String table, List<?> payload, String onConflict) {
    if (payload.isEmpty()) {
      return objectMapper.createArrayNode();
    }

    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("on_conflict", onConflict);

    try {
      webClient
          .post()
          .uri(restUri(table, query))
          .contentType(MediaType.APPLICATION_JSON)
          .header("Prefer", "resolution=merge-duplicates,return=minimal")
          .bodyValue(payload)
          .retrieve()
          .toBodilessEntity()
          .block();
      return objectMapper.createArrayNode();
    } catch (WebClientResponseException exception) {
      throw mapException(exception);
    }
  }

  public ObjectNode updateSingle(String table, MultiValueMap<String, String> query, Object payload) {
    return executeObjectRequest(
        webClient
            .patch()
            .uri(restUri(table, query))
            .contentType(MediaType.APPLICATION_JSON)
            .header("Prefer", "return=representation")
            .accept(MediaType.valueOf("application/vnd.pgrst.object+json"))
            .bodyValue(payload));
  }

  public void delete(String table, MultiValueMap<String, String> query) {
    try {
      webClient.delete().uri(restUri(table, query)).retrieve().toBodilessEntity().block();
    } catch (WebClientResponseException exception) {
      throw mapException(exception);
    }
  }

  public JsonNode rpc(String functionName, Object payload) {
    try {
      return webClient
          .post()
          .uri(URI.create(baseUrl + "/rest/v1/rpc/" + functionName))
          .contentType(MediaType.APPLICATION_JSON)
          .accept(MediaType.APPLICATION_JSON)
          .bodyValue(payload)
          .retrieve()
          .bodyToMono(JsonNode.class)
          .block();
    } catch (WebClientResponseException exception) {
      throw mapException(exception);
    }
  }

  public void uploadObject(String bucket, String path, byte[] payload, String contentType) {
    URI uri =
        URI.create(
            baseUrl
                + "/storage/v1/object/"
                + UriUtils.encodePathSegment(bucket, StandardCharsets.UTF_8)
                + "/"
                + encodeStoragePath(path));

    try {
      webClient
          .post()
          .uri(uri)
          .header("x-upsert", "true")
          .contentType(
              contentType == null || contentType.isBlank()
                  ? MediaType.APPLICATION_OCTET_STREAM
                  : MediaType.parseMediaType(contentType))
          .bodyValue(payload)
          .retrieve()
          .toBodilessEntity()
          .block();
    } catch (WebClientResponseException exception) {
      throw mapException(exception);
    }
  }

  public MultiValueMap<String, String> filters(Map<String, String> entries) {
    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    entries.forEach(
        (key, value) -> {
          if (value != null && !value.isBlank()) {
            query.add(key, value);
          }
        });
    return query;
  }

  private JsonNode performGet(URI uri, String accept) {
    try {
      return webClient
          .get()
          .uri(uri)
          .accept(MediaType.parseMediaType(accept))
          .retrieve()
          .bodyToMono(JsonNode.class)
          .block();
    } catch (WebClientResponseException exception) {
      throw mapException(exception);
    }
  }

  private ArrayNode executeArrayRequest(WebClient.RequestHeadersSpec<?> request) {
    try {
      JsonNode response = request.retrieve().bodyToMono(JsonNode.class).block();
      if (response instanceof ArrayNode arrayNode) {
        return arrayNode;
      }
      ArrayNode wrapped = objectMapper.createArrayNode();
      if (response != null) {
        wrapped.add(response);
      }
      return wrapped;
    } catch (WebClientResponseException exception) {
      throw mapException(exception);
    }
  }

  private ObjectNode executeObjectRequest(WebClient.RequestHeadersSpec<?> request) {
    try {
      JsonNode response = request.retrieve().bodyToMono(JsonNode.class).block();
      if (response instanceof ObjectNode objectNode) {
        return objectNode;
      }
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Expected a single JSON object from Supabase.");
    } catch (WebClientResponseException exception) {
      throw mapException(exception);
    }
  }

  URI restUri(String table, MultiValueMap<String, String> query) {
    StringBuilder uri =
        new StringBuilder(baseUrl)
            .append("/rest/v1/")
            .append(UriUtils.encodePathSegment(table, StandardCharsets.UTF_8));
    if (query != null && !query.isEmpty()) {
      uri.append("?");
      boolean[] first = {true};
      query.forEach(
          (key, values) ->
              values.forEach(
                  value -> {
                    if (!first[0]) {
                      uri.append("&");
                    }
                    first[0] = false;
                    uri.append(encodeQueryParam(key)).append("=").append(encodeQueryParam(value));
                  }));
    }
    return URI.create(uri.toString());
  }

  private String encodeQueryParam(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  private String encodeStoragePath(String path) {
    return Arrays.stream(path.split("/"))
        .map(segment -> UriUtils.encodePathSegment(segment, StandardCharsets.UTF_8))
        .reduce((left, right) -> left + "/" + right)
        .orElse(path);
  }

  private ApiException mapException(WebClientResponseException exception) {
    String message = exception.getResponseBodyAsString();
    if (message == null || message.isBlank()) {
      message = exception.getMessage();
    }
    return new ApiException(HttpStatus.valueOf(exception.getStatusCode().value()), message);
  }

  private String resolveSetting(String configuredValue, String envKey, String fallback) {
    if (configuredValue != null && !configuredValue.isBlank()) {
      return configuredValue;
    }

    String environmentValue = System.getenv(envKey);
    if (environmentValue != null && !environmentValue.isBlank()) {
      return environmentValue;
    }

    return fallback;
  }
}

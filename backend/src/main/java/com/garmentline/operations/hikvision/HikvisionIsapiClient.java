package com.garmentline.operations.hikvision;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.garmentline.operations.hikvision.model.HikvisionCameraConfig;
import com.garmentline.operations.support.ApiException;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.net.ssl.SSLHandshakeException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

@Component
public class HikvisionIsapiClient {

  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(8);

  private final HttpClient httpClient;
  private final ObjectMapper objectMapper;

  public HikvisionIsapiClient(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
    this.httpClient =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
  }

  public JsonNode getJson(HikvisionCameraConfig config, String path) {
    String body = send(config, "GET", path, null, null).body();
    try {
      return objectMapper.readTree(body);
    } catch (IOException exception) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY, "Camera returned a non-JSON response for " + path + ".");
    }
  }

  public String getText(HikvisionCameraConfig config, String path) {
    return send(config, "GET", path, null, null).body();
  }

  public JsonNode postJson(HikvisionCameraConfig config, String path, Object payload) {
    String body;
    try {
      body = objectMapper.writeValueAsString(payload);
    } catch (IOException exception) {
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not serialize camera request.");
    }

    String responseBody = send(config, "POST", path, body, MediaType.APPLICATION_JSON_VALUE).body();
    try {
      return objectMapper.readTree(responseBody);
    } catch (IOException exception) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY, "Camera returned a non-JSON response for " + path + ".");
    }
  }

  private HikvisionHttpResponse send(
      HikvisionCameraConfig config, String method, String path, String body, String contentType) {
    URI uri = buildUri(config.baseUrl(), path);
    HttpRequest request = buildRequest(uri, method, body, contentType, null);
    HttpResponse<String> firstResponse = execute(request);

    if (firstResponse.statusCode() != 401) {
      return validateResponse(path, firstResponse);
    }

    Optional<String> challengeHeader = firstResponse.headers().firstValue("WWW-Authenticate");
    String challenge = challengeHeader.orElse("");
    String authorization =
        challenge.toLowerCase(Locale.ROOT).startsWith("basic")
            ? basicAuthorization(config)
            : digestAuthorization(config, method, uri, challenge);

    HttpResponse<String> authenticatedResponse =
        execute(buildRequest(uri, method, body, contentType, authorization));
    return validateResponse(path, authenticatedResponse);
  }

  private HttpResponse<String> execute(HttpRequest request) {
    try {
      return httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    } catch (SSLHandshakeException exception) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          "Camera HTTPS certificate is not trusted by the backend. Use http:// for local testing or import the camera certificate into the Java truststore.");
    } catch (IOException exception) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          "Could not reach Hikvision camera. Check IP address, port, WiFi, and camera HTTP/HTTPS settings.");
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Camera request was interrupted.");
    }
  }

  private HttpRequest buildRequest(
      URI uri, String method, String body, String contentType, String authorization) {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(uri)
            .timeout(REQUEST_TIMEOUT)
            .header("Accept", "application/json, application/xml, text/xml, */*")
            .header("User-Agent", "LineMatrix-Hikvision-ISAPI/1.0");

    if (authorization != null && !authorization.isBlank()) {
      builder.header("Authorization", authorization);
    }

    if (body == null) {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    } else {
      builder.header("Content-Type", contentType == null ? MediaType.APPLICATION_JSON_VALUE : contentType);
      builder.method(method, HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
    }

    return builder.build();
  }

  private HikvisionHttpResponse validateResponse(String path, HttpResponse<String> response) {
    int status = response.statusCode();
    if (status >= 200 && status < 300) {
      return new HikvisionHttpResponse(status, response.body());
    }

    if (status == 401) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, "Camera rejected the username or password.");
    }

    throw new ApiException(
        HttpStatus.BAD_GATEWAY,
        "Camera request failed for "
            + path
            + " with HTTP "
            + status
            + cameraErrorSuffix(response.body()));
  }

  private String cameraErrorSuffix(String body) {
    if (body == null || body.isBlank()) {
      return ".";
    }
    String normalized = body.replaceAll("\\s+", " ").trim();
    return ". Camera response: " + normalized.substring(0, Math.min(normalized.length(), 240));
  }

  private URI buildUri(String baseUrl, String path) {
    String normalizedBase = baseUrl == null ? "" : baseUrl.trim();
    if (normalizedBase.endsWith("/")) {
      normalizedBase = normalizedBase.substring(0, normalizedBase.length() - 1);
    }
    if (!normalizedBase.startsWith("http://") && !normalizedBase.startsWith("https://")) {
      normalizedBase = "http://" + normalizedBase;
    }
    return URI.create(normalizedBase + path);
  }

  private String basicAuthorization(HikvisionCameraConfig config) {
    String token = config.username() + ":" + nullToEmpty(config.password());
    return "Basic "
        + java.util.Base64.getEncoder()
            .encodeToString(token.getBytes(StandardCharsets.UTF_8));
  }

  private String digestAuthorization(
      HikvisionCameraConfig config, String method, URI uri, String challenge) {
    Map<String, String> values = parseDigestChallenge(challenge);
    String realm = values.getOrDefault("realm", "");
    String nonce = values.getOrDefault("nonce", "");
    String qop = values.getOrDefault("qop", "auth");
    String opaque = values.get("opaque");
    String algorithm = values.getOrDefault("algorithm", "MD5");

    if (!algorithm.equalsIgnoreCase("MD5")) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, "Camera requested unsupported digest algorithm: " + algorithm);
    }

    if (nonce.isBlank()) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, "Camera did not provide a digest nonce.");
    }

    String requestUri = uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
    String nc = "00000001";
    String cnonce = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    String ha1 = md5(config.username() + ":" + realm + ":" + nullToEmpty(config.password()));
    String ha2 = md5(method + ":" + requestUri);
    String response;

    if (qop.toLowerCase(Locale.ROOT).contains("auth")) {
      response = md5(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2);
    } else {
      response = md5(ha1 + ":" + nonce + ":" + ha2);
    }

    StringBuilder header = new StringBuilder("Digest ");
    appendDigestField(header, "username", config.username(), true);
    appendDigestField(header, "realm", realm, true);
    appendDigestField(header, "nonce", nonce, true);
    appendDigestField(header, "uri", requestUri, true);
    appendDigestField(header, "response", response, true);
    appendDigestField(header, "algorithm", algorithm, false);
    if (qop.toLowerCase(Locale.ROOT).contains("auth")) {
      appendDigestField(header, "qop", "auth", false);
      appendDigestField(header, "nc", nc, false);
      appendDigestField(header, "cnonce", cnonce, true);
    }
    if (opaque != null && !opaque.isBlank()) {
      appendDigestField(header, "opaque", opaque, true);
    }

    if (header.substring(header.length() - 2).equals(", ")) {
      header.setLength(header.length() - 2);
    }
    return header.toString();
  }

  private Map<String, String> parseDigestChallenge(String challenge) {
    String normalized = challenge.replaceFirst("(?i)^Digest\\s+", "");
    Map<String, String> values = new LinkedHashMap<>();
    StringBuilder current = new StringBuilder();
    boolean inQuotes = false;

    for (int index = 0; index < normalized.length(); index++) {
      char ch = normalized.charAt(index);
      if (ch == '"') {
        inQuotes = !inQuotes;
      }
      if (ch == ',' && !inQuotes) {
        putDigestPair(values, current.toString());
        current.setLength(0);
      } else {
        current.append(ch);
      }
    }
    putDigestPair(values, current.toString());
    return values;
  }

  private void putDigestPair(Map<String, String> values, String pair) {
    int equalsIndex = pair.indexOf('=');
    if (equalsIndex <= 0) {
      return;
    }
    String key = pair.substring(0, equalsIndex).trim();
    String value = pair.substring(equalsIndex + 1).trim();
    if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) {
      value = value.substring(1, value.length() - 1);
    }
    values.put(key, value);
  }

  private void appendDigestField(
      StringBuilder builder, String key, String value, boolean quoted) {
    builder.append(key).append('=');
    if (quoted) {
      builder.append('"').append(value).append('"');
    } else {
      builder.append(value);
    }
    builder.append(", ");
  }

  private String md5(String value) {
    try {
      MessageDigest digest = MessageDigest.getInstance("MD5");
      byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder builder = new StringBuilder(bytes.length * 2);
      for (byte next : bytes) {
        builder.append(String.format("%02x", next));
      }
      return builder.toString();
    } catch (NoSuchAlgorithmException exception) {
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "MD5 digest support is unavailable.");
    }
  }

  private String nullToEmpty(String value) {
    return value == null ? "" : value;
  }

  private record HikvisionHttpResponse(int statusCode, String body) {
  }
}

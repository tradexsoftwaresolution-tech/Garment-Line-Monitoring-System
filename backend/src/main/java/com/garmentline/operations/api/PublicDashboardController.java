package com.garmentline.operations.api;

import com.garmentline.operations.service.PublicDashboardService;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/public")
public class PublicDashboardController {

  private final PublicDashboardService publicDashboardService;

  public PublicDashboardController(PublicDashboardService publicDashboardService) {
    this.publicDashboardService = publicDashboardService;
  }

  @GetMapping("/exclusive-dashboard")
  public ResponseEntity<Map<String, Object>> exclusiveDashboard(
      @RequestParam(required = false) String attendanceDate) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(publicDashboardService.exclusiveDashboardSnapshot(attendanceDate));
  }
}

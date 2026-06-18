package com.garmentline.operations.api;

import com.garmentline.operations.service.PublicDashboardService;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/public")
public class PublicDashboardController {

  private final PublicDashboardService publicDashboardService;

  public PublicDashboardController(PublicDashboardService publicDashboardService) {
    this.publicDashboardService = publicDashboardService;
  }

  @GetMapping("/exclusive-dashboard")
  public Map<String, Object> exclusiveDashboard() {
    return publicDashboardService.exclusiveDashboardSnapshot();
  }
}

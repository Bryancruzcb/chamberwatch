variable "account_id" {
  description = "AWS account ID. It keeps the provider off every other account."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "The account_id value must be the 12-digit AWS account ID."
  }
}

variable "instance_type" {
  description = "Graviton instance. t4g.micro has 1 GB and runs the demo with swap; t4g.small has 2 GB if that is too tight."
  type        = string
  default     = "t4g.micro"

  validation {
    condition     = can(regex("^t4g\\.", var.instance_type))
    error_message = "The AMI is arm64, so the instance type must be a t4g type."
  }
}

variable "git_ref" {
  description = "Branch or tag the box clones and builds."
  type        = string
  default     = "main"
}

variable "swap_gb" {
  description = "Swap file size. It gives the image build and the first load room on a 1 GB instance."
  type        = number
  default     = 2
}
